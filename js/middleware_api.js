'use strict'

var middleware = (function() {
	
	//Reusable stuff
    var PeerConnection_Config = {
		iceServers: [
		{
			url: "stun:stun.l.google.com:19302"
		},
		{
			url: "stun:stun.servers.mozilla.com"
		}]
	};	
    
    var Offer = {
        createOffer: function(config) {
            var peer = new RTCPeerConnection(PeerConnection_Config);
            if (config.stream) {    
                try {
                    peer.addStream(config.stream);
                } catch (error) {
                    console.log("Add stream error: " + error.message);
                }
				console.log('Added localStream to PeerConnection');
            }
            if (config.onicecandidate) {
                peer.onicecandidate = function(event) {
                    if (event.candidate) {
                        config.onicecandidate(event);
                    }
                };
            }           
            
            var _desc = null;
            function gotLocalDescription() {
                config.gotLocalDescription(_desc);
            }
            
            peer.createOffer(
                function (description) {
                    _desc = description;                 
                    peer.setLocalDescription(
                        _desc, 
                        gotLocalDescription, 
                        function () {
                            console.log("Set local description error");
                    }
                )},
                function (error) {
					console.log('Failed to create offer: ' + error.toString());
				},  
                config.sdpConstraints
            );
            this.peer = peer;
            //Use this to let the caller use the other methods when response is ready
            return this;
        },
        setRemoteDescription: function(sdp) {
            this.peer.setRemoteDescription(new RTCSessionDescription(sdp));
        },
        addIceCandidate: function(candidate) {
            this.peer.addIceCandidate(new RTCIceCandidate(candidate));
        },
        stopSpeech: function () {
            if(this.peer && this.peer.signalingState != "closed") {
					this.peer.close();
					this.peer = null;
            }
        },
        checkStatus: function () {
            if(!this.peer || this.peer.iceConnectionState == "new"
				|| this.peer.iceConnectionState == "checking")
				return false;
			else if(this.peer.iceConnectionState == "closed") {
				this.peer = null;
				return false;
			}		
			else
				return true;
        }
    };
    
	//API for Soapbox website
	window.Soapbox = function() {
        var self = this;
		var ws, stomp, send_queue;
		var PeerConnection, localStream, speech_info;
				
		var sdpConstraints = {
			optional: [],
			mandatory: {
				OfferToReceiveAudio: false,
				OfferToReceiveVideo: false
			}
		};		
        
        var peers = {};
        
        this.itself = "soapbox";
		this.connect = connectMiddleware;
		this.submit = submitSpeechInfo;
		this.update = submitSpeechInfo;
        this.register = registerInMiddleware; 
		this.start = startBroadcast;
		this.stop = stopBroadcast;
		this.send = sendMessageToMiddleware;
		this.onreceivelikes = onReceiveLikesUpdate;
		this.onreceivedislikes = onReceiveDislikesUpdate;
		this.onreceivereports = onReceiveReportsUpdate;
		
		//Record API
		this.record = recordSpeechInBackground;
		
		function onReceiveLikesUpdate(likes) {
			//None
		}
		
		function onReceiveDislikesUpdate(dislikes) {
			//None
		}
		
		function onReceiveReportsUpdate(reports) {
			//None
		}
		
		function submitSpeechInfo(speech_info) {
			if (typeof speech_info !== "object") {
				console.log("Wrong speech info format. Submit failure!");
				self.speech_info = {};
				return false;
			} else {
				self.speech_info = speech_info;
				sendMessageToMiddleware("meta-data", speech_info);
			}
		}
        
		function connectMiddleware(onConnectCallback, onErrorCallback, onReceiveMessage, configuration) {
			//Parsing config params
			var configuration = configuration || {};
			var server_url = configuration.server_url || 'bunny.ubioulu.fi:15674/stomp';
			self.send_queue = configuration.send_queue || "/exchange/soapbox/middleware";
			var receive_queue = configuration.receive_queue || "/exchange/soapbox/soapbox";
			var user_name = configuration.user_name || 'soapbox';
			var password = configuration.password || '7rD7zL8RtckRzEXD';
			var vhost = configuration.vhost || '/';
			var debug = configuration.debug || true;
			
			//Stomp initialization
			ws = new SockJS(server_url);
			self.stomp = Stomp.over(ws);
			self.stomp.heartbeat.outgoing = 0;
			self.stomp.heartbeat.incoming = 0;
			if(!debug)
				self.stomp.debug = null;
			
			self.stomp.connect(user_name, password, 
				function(connected_frame) {                    
					var id = self.stomp.subscribe(receive_queue, 
						//Handling incoming messages
						function(message) {                            
							var signal = JSON.parse(message.body);						
							if(signal.receiver !== 'soapbox')
							{	
                                console.log("Messages routing error!");
								return signal;
							}							
							//Assume soapbox will fire the offer according to middleware's request
							if (signal.type == "answer" && signal.data.sdp && signal.data.hotspot_id) {				
								peers[signal.data.hotspot_id].setRemoteDescription(signal.data.sdp);
							} 
							else if(signal.type == "ice-candidate" && signal.data.ice && signal.data.hotspot_id) {
								peers[signal.data.hotspot_id].addIceCandidate(signal.data.ice);
							} 
							else if(signal.type == "stop_broadcast" && signal.data.hotspot_id) {
								peers[signal.data.hotspot_id].stopSpeech();
							}
                            else if (signal.type == "request_offer" && signal.data.hotspot_id) {
                                createOffer(signal.data.hotspot_id);
                            }
							else if(signal.type == "like") {
								console.log("Now a like");
								onReceiveLikesUpdate(signal.data.likes);
							}
							else if(signal.type == "dislike") {
								onReceiveDislikesUpdate(signal.data.dislikes);
							}
							else if(signal.type == "report") {
								onReceiveReportsUpdate(signal.data.reports);
							}
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});	
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(connected_frame);
			}, function(error) {
				console.log(error.toString());
				return typeof onErrorCallback !== "function" ? null :onErrorCallback(error);
			}, vhost);
			
		}
		
        function registerInMiddleware(){
            sendMessageToMiddleware("register", null);
        }
        
        //Only tells middleware that it wants to start broadcasting now, middleware will ask for offer
		function startBroadcast(stream) {
            self.localStream = stream;
            sendMessageToMiddleware("start_broadcast", null);
        }
        
        function stopBroadcast() {
            sendMessageToMiddleware("stop_broadcast", null);
        }
        
        //Called when middleware sends a request_offer message. Offer will be requested only when new hotspot website is online
        function createOffer(hotspot_id) {
            var options = {
                "stream": self.localStream,
                "onicecandidate": function (event) {
                    sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'hotspot_id': hotspot_id});
                    
                },
                "gotLocalDescription": function (description) {      
                    sendMessageToMiddleware("offer", {'sdp': description, 'hotspot_id': hotspot_id});
                },
                "sdpConstraints": self.sdpConstraints
            };            
            peers[hotspot_id] = Offer.createOffer(options);			
		}
		
        function sendMessageToMiddleware(type, payload) {     
            var message_object = {
                'sender': self.itself,
                'receiver': "middleware",
                'timestamp': new Date().toISOString(),
                'type': type,
                'data': payload || {}
            };
            if(self.stomp.connected !== true) {
                console.log("Connection to middleware is not on yet. Send failure.");
                return;
            } 
            else 
            {
                self.stomp.send(self.send_queue, {}, JSON.stringify(message_object));
            }
        }
		
		function recordSpeechInBackground(video_element, stream_element) {
			var recorder = MultiStreamRecorder(stream_element);
			console.log(recorder);
			//recorder.video = video_element; //to get maximum accuracy
			recorder.ondataavailable = function (blobs) {
				console.log("Blobs received.");
			};
			recorder.start(3 * 1000);
		}
		
    };
    
    
    
	
	//API for Hotspot viewer website	
	window.Hotspot = function () {
		var self = this;
		var ws, stomp, send_queue;
		var PeerConnection, remoteVideo, remoteStream, hotspot_id;
		
        this.itself = "hotspot";
		this.setup = setupVideoDisplayObject;
		this.connect = connectMiddleware;
        this.register = registerInMiddleware;
		this.send = sendMessageToMiddleware;
		this.like = addLike;
		this.dislike = addDislike;
		this.report = reportInappropriateContent;
		this.onreceivelikes = onReceiveLikesUpdate;
		this.onreceivedislikes = onReceiveDislikesUpdate;
		this.onreceivereports = onReceiveReportsUpdate;
		
		function onReceiveLikesUpdate(likes) {
			//None
		}
		
		function onReceiveDislikesUpdate(dislikes) {
			//None
		}
		
		function onReceiveReportsUpdate(reports) {
			//None
		}
		
		//Try to tell signaling server that it is about to close
		window.onbeforeunload = function(event) {
            sendMessageToMiddleware("unregister", {"hotspot_id": hotspot_id});
		};
		
		function setupVideoDisplayObject(remoteVideoObject) {
			self.remoteVideo = remoteVideoObject;
		}
		
        function registerInMiddleware(){
            waitForSpeechTransmission();
            sendMessageToMiddleware("register", {"name": "test-hotspot-15"});
        }
        
		function connectMiddleware(onConnectCallback, onErrorCallback, onReceiveMessage, configuration) {
			//Parsing config params
			var configuration = configuration || {};
			var server_url = configuration.server_url || 'bunny.ubioulu.fi:15674/stomp';
			self.send_queue = configuration.send_queue || "/exchange/soapbox/middleware";
			var receive_queue = configuration.receive_queue || "/exchange/soapbox/hotspot";
			var user_name = configuration.user_name || 'soapbox';
			var password = configuration.password || '7rD7zL8RtckRzEXD';
			var vhost = configuration.vhost || '/';
			var debug = configuration.debug || true;
			
			//Stomp initialization
			self.ws = new SockJS(server_url);
			self.stomp = Stomp.over(self.ws);
			self.stomp.heartbeat.outgoing = 0;
			self.stomp.heartbeat.incoming = 0;
			if(!debug)
				self.stomp.debug = null;
			
			self.stomp.connect(user_name, password, 
				function(connected_frame) {
					var id = self.stomp.subscribe(receive_queue, 
						//Handling incoming messages
						function (message) {
							var signal = JSON.parse(message.body);
							if(signal.receiver !== 'hotspot' && signal.receiver !== 'all')
							{	
								return;
							}					
                            if (hotspot_id && signal.data.hotspot_id && hotspot_id !== signal.data.hotspot_id) {
                                return;
                            }
                            if (signal.type == "register" && signal.data.hotspot_id) {
                                hotspot_id = signal.data.hotspot_id;
                                console.log("My hotspot id: ", hotspot_id);
                            }
							if (signal.type == "offer" && signal.data.sdp) {				
								waitForSpeechTransmission();						
								self.PeerConnection.setRemoteDescription(new RTCSessionDescription(signal.data.sdp), function () {
									self.PeerConnection.createAnswer(
										_gotLocalDescription, 
										function (error) {
											console.log('Failed to create answer: ' + error.toString());
										});
								});
							} 
							else if(signal.type == "ice-candidate" && signal.data.ice) {
								self.PeerConnection.addIceCandidate(new RTCIceCandidate(signal.data.ice));
							}
							else if(signal.type == "stop_broadcast") {
								stopSpeechTransmission();
							}
							else if(signal.type == "like") {
								onReceiveLikesUpdate(signal.data.likes);
							}
							else if(signal.type == "dislike") {
								onReceiveDislikesUpdate(signal.data.dislikes);
							}
							else if(signal.type == "report") {
								onReceiveReportsUpdate(signal.data.reports);
							}
							
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});                    
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(connected_frame);
                }, function(error) {
                    console.log('Failed to connect to signaling server: ' + error.toString());
                    return typeof onErrorCallback !== "function" ? null :onErrorCallback(error);
                }, vhost);
			
		}
		
		function waitForSpeechTransmission() {
			if(!self.PeerConnection) {
				self.PeerConnection = new RTCPeerConnection(PeerConnection_Config);
				console.log('Created local peer connection object PeerConnection');
				self.PeerConnection.onicecandidate = _gotLocalIceCandidate;
				self.PeerConnection.onaddstream = _gotRemoteStream;
				return true;
			}
			else {
				console.log("Transmission has already started.");
				return false;
			}
		}
		
		function stopSpeechTransmission(initiative) {
            if(self.PeerConnection && self.PeerConnection.signalingState != "closed") {
                self.PeerConnection.close();
                self.PeerConnection = null;						
                console.log("Speech transmission stopped");
                return true;
            } else {
                console.log("Stop speech failure");
                return false;
            }					
		}
		
		function checkSpeechTransmissionStatus() {
			if(!self.PeerConnection || self.PeerConnection.iceConnectionState == "new"
				|| self.PeerConnection.iceConnectionState == "checking")
				return false;
			else if(self.PeerConnection.iceConnectionState == "closed") {
				self.PeerConnection = null;
				return false;
			}		
			else
				return true;
		}
		
		function sendMessageToMiddleware(type, payload) {
			var message_object = {
				'sender': self.itself,
				'receiver': "middleware",
				'timestamp': new Date().toISOString(),
				'type': type,
				'data': payload || {}
			};
			if(self.stomp.connected !== true) {
				console.log("Connection to middleware is not on yet. Send failure.");
				return;
			} else {
				self.stomp.send(self.send_queue, {}, JSON.stringify(message_object));
			}
		}
        
		function addLike() {
			sendMessageToMiddleware("like", {"hotspot": "test-hotspot"});
		}
		
		function addDislike() {
			sendMessageToMiddleware("dislike", {"hotspot": "test-hotspot"});
		}
		
		function reportInappropriateContent() {
			sendMessageToMiddleware("report", {"hotspot": "test-hotspot"});
		}
		
		
		
		
		
		
		
		
		
		//Local functions
		function _gotLocalDescription(description) {
			self.PeerConnection.setLocalDescription(
				description,	
				function () {
					sendMessageToMiddleware('answer', {'sdp': description, 'hotspot_id': hotspot_id});
					console.log('Answer sdp generated');
				}, 
				function () { 
					console.log("Set local description error");
				}
			);  
		}
		
		function _gotLocalIceCandidate(event) {
			if (event.candidate) {
				sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'hotspot_id': hotspot_id});
				console.log('Local ICE candidate gathered');
			}
		}
		
		function _gotRemoteStream(event) {			
			console.log('Received remote stream');
			self.remoteStream = event.stream;
			self.remoteVideo.src = URL.createObjectURL(event.stream);
		}
	};
	
	
	//API for Audience who will comment on current speech 
	window.Audience = function () {
		//Unimplemented
	};
	
})();










