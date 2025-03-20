import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

function App() {
  const [connected, setConnected] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [status, setStatus] = useState('Déconnecté');
  const [theme, setTheme] = useState('light');
  const [transition, setTransition] = useState(false);
  
  // WebRTC states
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [partnerVideo, setPartnerVideo] = useState(true);
  const [partnerAudio, setPartnerAudio] = useState(true);
  const [videoError, setVideoError] = useState(null);
  
  // References
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  
  // WebRTC Configuration
  const peerConnectionConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    // Scroll to bottom whenever messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Apply theme to the document
    document.body.className = theme;
  }, [theme]);
  
  // Cleanup WebRTC on unmount
  useEffect(() => {
    return () => {
      closePeerConnection();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Toggle theme
  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };
  
  // Initialize WebRTC
  const initializeWebRTC = async () => {
    try {
      // Si en développement et pas d'accès webcam, utiliser un flux factice
      let stream;
      try {
        const constraints = { video: true, audio: true };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (mediaError) {
        console.warn('Pas d\'accès à la webcam, utilisation d\'un flux factice', mediaError);
        
        // Créer un canvas comme source vidéo factice
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        
        // Animation simple avec texte et heure
        const drawFrame = () => {
          // Fond noir
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Grand texte au centre
          ctx.fillStyle = '#ffffff';
          ctx.font = '30px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Caméra simulée', canvas.width/2, canvas.height/2 - 30);
          
          // Heure actuelle
          const now = new Date();
          ctx.fillText(now.toLocaleTimeString(), canvas.width/2, canvas.height/2 + 30);
          
          // Appel récursif pour l'animation
          requestAnimationFrame(drawFrame);
        };
        
        // Démarrer l'animation
        drawFrame();
        
        // Convertir le canvas en flux vidéo
        stream = canvas.captureStream(30);
      }
      
      // Stocker la référence au stream
      localStreamRef.current = stream;
      
      // Attacher explicitement le stream à l'élément vidéo
      if (localVideoRef.current) {
        console.log('Attachement du stream vidéo local', stream.id);
        localVideoRef.current.srcObject = stream;
        
        // Forcer la lecture de la vidéo
        localVideoRef.current.onloadedmetadata = () => {
          console.log('Vidéo locale chargée, lecture démarrée');
          localVideoRef.current.play().catch(e => {
            console.error('Erreur lecture vidéo locale:', e);
          });
        };
      } else {
        console.error('Référence vidéo locale non disponible');
      }
      
      addSystemMessage('Flux vidéo configuré');
      setVideoError(null);
      return true;
    } catch (error) {
      console.error('Erreur d\'initialisation WebRTC:', error);
      addSystemMessage(`Erreur: ${error.message}`);
      setVideoError(error.message);
      return false;
    }
  };
  
  // Create RTCPeerConnection
  const createPeerConnection = () => {
    // Create a new RTCPeerConnection
    const peerConnection = new RTCPeerConnection(peerConnectionConfig);
    
    // Add local stream tracks to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceCandidate(event.candidate);
      }
    };
    
    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
    };
    
    // Handle receiving remote stream
    peerConnection.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    
    peerConnectionRef.current = peerConnection;
    return peerConnection;
  };
  
  // Close peer connection
  const closePeerConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };
  
  // Create and send offer
  const createAndSendOffer = async () => {
    try {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) return;
      
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      sendSdpOffer(offer);
    } catch (error) {
      console.error('Error creating offer:', error);
      addSystemMessage(`Erreur lors de la création de l'offre: ${error.message}`);
    }
  };
  
  // Handle received offer
  const handleReceivedOffer = async (offer) => {
    try {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) return;
      
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      sendSdpAnswer(answer);
    } catch (error) {
      console.error('Error handling offer:', error);
      addSystemMessage(`Erreur lors du traitement de l'offre: ${error.message}`);
    }
  };
  
  // Handle received answer
  const handleReceivedAnswer = async (answer) => {
    try {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) return;
      
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('Error handling answer:', error);
      addSystemMessage(`Erreur lors du traitement de la réponse: ${error.message}`);
    }
  };
  
  // Handle received ICE candidate
  const handleReceivedIceCandidate = (candidate) => {
    try {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) return;
      
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };
  
  // Send SDP Offer
  const sendSdpOffer = (offer) => {
    if (socketRef.current) {
      socketRef.current.emit('sdp-offer', offer);
    }
  };
  
  // Send SDP Answer
  const sendSdpAnswer = (answer) => {
    if (socketRef.current) {
      socketRef.current.emit('sdp-answer', answer);
    }
  };
  
  // Send ICE Candidate
  const sendIceCandidate = (candidate) => {
    if (socketRef.current) {
      socketRef.current.emit('ice-candidate', candidate);
    }
  };
  
  // Toggle media controls
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !videoEnabled;
      });
      
      setVideoEnabled(!videoEnabled);
      
      // Notify partner
      if (socketRef.current) {
        socketRef.current.emit('media-controls', {
          type: 'video',
          enabled: !videoEnabled
        });
      }
    }
  };
  
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !audioEnabled;
      });
      
      setAudioEnabled(!audioEnabled);
      
      // Notify partner
      if (socketRef.current) {
        socketRef.current.emit('media-controls', {
          type: 'audio',
          enabled: !audioEnabled
        });
      }
    }
  };

  // Connect to server
  const connectToServer = async () => {
    setTransition(true);
    setStatus('Connexion en cours...');
    
    // First, initialize WebRTC
    const webrtcInitialized = await initializeWebRTC();
    if (!webrtcInitialized) {
      setTransition(false);
      setStatus('Erreur d\'accès aux médias');
      return;
    }
    
    const SOCKET_SERVER_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';
    socketRef.current = io(SOCKET_SERVER_URL, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000
    });
    console.log('Tentative de connexion à:', SOCKET_SERVER_URL);
    
    socketRef.current.on('connect', () => {
      console.log('Connecté au serveur!', socketRef.current.id);
      setConnected(true);
      setStatus('Connecté');
      setTimeout(() => setTransition(false), 300);
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('Erreur de connexion Socket.IO:', error);
      setStatus('Erreur de connexion');
    });
    
    socketRef.current.on('chat-started', (data) => {
      setChatting(true);
      setMessages([]);
      setStatus('Chat actif');
      addSystemMessage('Vous êtes connecté avec un étranger. Dites bonjour !');
      
      // Initialize peer connection for WebRTC
      createPeerConnection();
      
      // Initiator creates and sends offer
      // We define the initiator as the one with the "smaller" socket ID
      const isInitiator = socketRef.current.id < data.roomId.split('_')[1];
      if (isInitiator) {
        setTimeout(() => createAndSendOffer(), 1000);
      }
      
      setTimeout(() => messageInputRef.current?.focus(), 300);
    });
    
    socketRef.current.on('receive-message', (data) => {
      console.log('Message reçu:', data);
      const isFromSelf = data.senderId === socketRef.current.id;
      addMessage(data.message, isFromSelf ? 'you' : 'stranger');
      
      // Notification sonore uniquement pour les messages des autres
      if (!isFromSelf) {
        playNotificationSound();
      }
    });
    
    // WebRTC signaling handlers
    socketRef.current.on('sdp-offer', (offer) => {
      handleReceivedOffer(offer);
    });
    
    socketRef.current.on('sdp-answer', (answer) => {
      handleReceivedAnswer(answer);
    });
    
    socketRef.current.on('ice-candidate', (candidate) => {
      handleReceivedIceCandidate(candidate);
    });
    
    // Media controls update
    socketRef.current.on('media-controls', (data) => {
      if (data.type === 'video') {
        setPartnerVideo(data.enabled);
      } else if (data.type === 'audio') {
        setPartnerAudio(data.enabled);
      }
    });
    
    socketRef.current.on('chat-ended', (data) => {
      setTransition(true);
      setTimeout(() => {
        setChatting(false);
        setStatus('Chat terminé');
        addSystemMessage(`Chat terminé: ${data.reason === 'partner-disconnected' ? 
          'L\'étranger s\'est déconnecté' : 'L\'étranger est passé à un autre chat'}`);
        
        // Close WebRTC peer connection
        closePeerConnection();
        
        setTransition(false);
      }, 300);
    });
    
    socketRef.current.on('finding-new-chat', () => {
      setTransition(true);
      setTimeout(() => {
        setChatting(false);
        setStatus('Recherche d\'un nouveau chat...');
        
        // Close previous WebRTC peer connection
        closePeerConnection();
        
        setTransition(false);
      }, 300);
    });
    
    socketRef.current.on('disconnect', () => {
      setTransition(true);
      setTimeout(() => {
        setConnected(false);
        setChatting(false);
        setStatus('Déconnecté');
        addSystemMessage('Déconnecté du serveur');
        
        // Close WebRTC peer connection
        closePeerConnection();
        
        setTransition(false);
      }, 300);
    });
  };
  
  // Play notification sound
  const playNotificationSound = () => {
    const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU' + Array(20).join('A'));
    audio.volume = 0.2;
    audio.play().catch(e => console.log('Audio play failed:', e));
  };
  
  // Start chat
  const startChat = () => {
    if (socketRef.current) {
      setTransition(true);
      setMessages([]);
      setStatus('Recherche d\'un partenaire...');
      socketRef.current.emit('find-chat');
      setTimeout(() => setTransition(false), 300);
      
      // Reset partner media states
      setPartnerVideo(true);
      setPartnerAudio(true);
    }
  };
  
  // Next chat
  const nextChat = () => {
    if (socketRef.current && chatting) {
      setTransition(true);
      socketRef.current.emit('next');
    }
  };
  
  // Send message
  const sendMessage = (e) => {
    e.preventDefault();
    if (inputMessage.trim() && chatting) {
      console.log('Envoi du message:', inputMessage);
      
      // N'ajoute PAS le message localement ici
      // Le message sera ajouté quand il reviendra du serveur
      socketRef.current.emit('send-message', { message: inputMessage });
      
      setInputMessage('');
    }
  };
  
  // Add message
  const addMessage = (message, sender) => {
    setMessages(prev => [...prev, { text: message, sender, time: new Date() }]);
  };
  
  // Add system message
  const addSystemMessage = (message) => {
    setMessages(prev => [...prev, { text: message, sender: 'system', time: new Date() }]);
  };
  
  // Disconnect from server
  const disconnectFromServer = () => {
    if (socketRef.current) {
      setTransition(true);
      socketRef.current.disconnect();
      
      // Stop local media stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      
      // Close peer connection
      closePeerConnection();
      
      // Reset local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      
      setTimeout(() => {
        setConnected(false);
        setChatting(false);
        setStatus('Déconnecté');
        setTransition(false);
      }, 300);
    }
  };

  return (
    <div className={`app-container ${theme} ${transition ? 'transition' : ''}`}>
      <header className="header">
        <div className="logo">
          <span className="logo-icon">💬</span>
          <h1>ChatterPOC</h1>
        </div>
        <div className="header-controls">
          <div className="status-indicator">
            <div className={`status-dot ${connected ? 'online' : 'offline'}`}></div>
            <span className="status-text">{status}</span>
          </div>
          <button onClick={toggleTheme} className="theme-toggle">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>
      
      {/* Video chat area */}
      {connected && (
        <div className="video-container">
          <div className="video-grid">
            <div className="video-wrapper local-video">
              {videoError ? (
                <div className="video-error">
                  <span className="error-icon">⚠️</span>
                  <p>Erreur webcam: {videoError}</p>
                </div>
              ) : (
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`${!videoEnabled ? 'disabled' : ''}`}
                />
              )}
              <div className="video-label">
                <span>Vous</span>
                <div className="media-indicators">
                  {!videoEnabled && <span className="media-off">📵</span>}
                  {!audioEnabled && <span className="media-off">🔇</span>}
                </div>
              </div>
            </div>
            
            <div className="video-wrapper remote-video">
              {chatting ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className={`${!partnerVideo ? 'disabled' : ''}`}
                />
              ) : (
                <div className="video-placeholder">
                  <span className="placeholder-icon">👤</span>
                  <p>En attente d'un partenaire...</p>
                </div>
              )}
              <div className="video-label">
                <span>Partenaire</span>
                <div className="media-indicators">
                  {!partnerVideo && <span className="media-off">📵</span>}
                  {!partnerAudio && <span className="media-off">🔇</span>}
                </div>
              </div>
            </div>
          </div>
          
          <div className="media-controls">
            <button
              onClick={toggleVideo}
              className={`media-btn ${!videoEnabled ? 'off' : ''}`}
              title={videoEnabled ? 'Désactiver vidéo' : 'Activer vidéo'}
            >
              {videoEnabled ? '📹' : '📵'}
            </button>
            <button
              onClick={toggleAudio}
              className={`media-btn ${!audioEnabled ? 'off' : ''}`}
              title={audioEnabled ? 'Désactiver micro' : 'Activer micro'}
            >
              {audioEnabled ? '🎤' : '🔇'}
            </button>
          </div>
        </div>
      )}
      
      {/* Text chat area */}
      <div className="chat-container">
        {messages.length === 0 && !chatting && connected ? (
          <div className="empty-state">
            <div className="empty-icon">👋</div>
            <h2>Prêt à discuter?</h2>
            <p>Cliquez sur "Démarrer un chat" pour être mis en relation avec quelqu'un de manière aléatoire.</p>
          </div>
        ) : (
          <div className="messages-container">
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={`message ${msg.sender} ${
                  index > 0 && messages[index-1].sender === msg.sender ? 'continued' : ''
                }`}
              >
                {msg.sender !== 'system' && (
                  <div className="message-bubble">
                    <div className="message-content">{msg.text}</div>
                    <div className="message-time">
                      {msg.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                )}
                {msg.sender === 'system' && (
                  <div className="system-message">
                    <div className="message-content">{msg.text}</div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} className="messages-end" />
          </div>
        )}
        
        <form onSubmit={sendMessage} className="message-form">
          <input
            ref={messageInputRef}
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={chatting ? "Tapez votre message..." : "Connectez-vous pour discuter..."}
            disabled={!chatting}
          />
          <button type="submit" disabled={!chatting || !inputMessage.trim()}>
            <span className="send-icon">➤</span>
          </button>
        </form>
      </div>
      
      <div className="controls">
        {!connected ? (
          <button onClick={connectToServer} className="primary-btn connect-btn">
            <span className="btn-icon">🔌</span>
            <span className="btn-text">Se connecter</span>
          </button>
        ) : (
          <div className="connected-controls">
            {!chatting ? (
              <button onClick={startChat} className="primary-btn start-chat-btn">
                <span className="btn-icon">🔍</span>
                <span className="btn-text">Démarrer un chat</span>
              </button>
            ) : (
              <button onClick={nextChat} className="primary-btn next-btn">
                <span className="btn-icon">⏭️</span>
                <span className="btn-text">Suivant</span>
              </button>
            )}
            <button onClick={disconnectFromServer} className="secondary-btn disconnect-btn">
              <span className="btn-icon">🔌</span>
              <span className="btn-text">Déconnecter</span>
            </button>
          </div>
        )}
      </div>
      
      <footer className="footer">
        <p>ChatterPOC &copy; {new Date().getFullYear()} - Développé pour apprentissage uniquement</p>
      </footer>
    </div>
  );
}

export default App;