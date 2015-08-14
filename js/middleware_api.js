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
        
        this.itself = "soapbox";
		this.connect = connectMiddleware;
		this.submit = submitSpeechInfoBeforeSpeech;
		this.start = startSpeechTransmission;
		this.stop = stopSpeechTransmission;
		this.check = checkSpeechTransmissionStatus;
		this.reset = resetSpeechTransmission;
		this.send = sendMessageToMiddleware;
		this.update = updateSpeechMetaData;
		this.onreceivelikes = onReceiveLikesUpdate;
		this.onreceivedislikes = onReceiveDislikesUpdate;
		this.onreceivereports = onReceiveReportsUpdate;
		
		//Record API
		this.record = recordSpeechInBackground;
		
		//Try to tell signaling server that it is about to close
		window.onbeforeunload = function(event) {
			sendMessageToMiddleware("stop_speech_transmission", null);
		};
		
		function onReceiveLikesUpdate(likes) {
			//None
		}
		
		function onReceiveDislikesUpdate(dislikes) {
			//None
		}
		
		function onReceiveReportsUpdate(reports) {
			//None
		}
		
		function submitSpeechInfoBeforeSpeech(speech_info) {
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
                    //Handle CONNECTED frame from rabbitmq server, and send session id to register in middleware
                    registerWithSessionID(connected_frame.headers.session);
                    
					var id = self.stomp.subscribe(receive_queue, 
						//Handling incoming messages
						function(message) {
                            
							var signal = JSON.parse(message.body);						
							if(signal.receiver !== 'soapbox' && signal.receiver !== 'all')
							{	
								return signal;
							}							
							//Assume soapbox will fire the offer
							if (signal.type == "answer" && signal.data.sdp) {				
								PeerConnection.setRemoteDescription(new RTCSessionDescription(signal.data.sdp));
							} 
							else if(signal.type == "ice-candidate" && signal.data.ice) {
								PeerConnection.addIceCandidate(new RTCIceCandidate(signal.data.ice));
							} 
							else if(signal.type == "stop_speech_transmission") {
								stopSpeechTransmission(false);
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
		
		function startSpeechTransmission(stream) {
			//Check if speech has started
			var status = checkSpeechTransmissionStatus();
			if (status) {
				console.log("Speech has already started");		
				return false;
			}	
			//Create PeerConnection, set onicecandidate
			PeerConnection = new RTCPeerConnection(PeerConnection_Config);
			console.log('Created local peer connection object PeerConnection');	
			PeerConnection.onicecandidate = _gotLocalIceCandidate;	
			//Add local stream
			try {
				PeerConnection.addStream(stream);
				localStream = stream;
				console.log('Added localStream to PeerConnection');
			} catch (error) {
				console.log("Add stream error: " + error.message);
				return false;
			}	
			
			//Description means SDP
			function _gotLocalDescription(description) {
				PeerConnection.setLocalDescription(
					description,
					function () {			
						sendMessageToMiddleware("offer", {'sdp': description});
						console.log('Offer sdp generated: \n');
						//console.log(description.sdp);
					},
					function () {
						console.log("Set local description error");
					}
				);    
			}
			
			function _gotLocalIceCandidate(event) {
				if (event.candidate) {
					sendMessageToMiddleware('ice-candidate', {'ice': event.candidate});
					console.log('Local ICE candidate gathered');
					//event.candidate.candidate;
				}
			}			
					
			//Create offer 
			return PeerConnection.createOffer(
				_gotLocalDescription, 
				function onCreateOfferError(error) {
					console.log('Failed to create offer: ' + error.toString());
					return false;
				}, 
				sdpConstraints
			);
		}
		
		function stopSpeechTransmission(initiative) {
			if (typeof initiative === "undefined" || initiative === true) {
				if(PeerConnection && PeerConnection.signalingState != "closed") {
					PeerConnection.close();
					PeerConnection = null;			
					sendMessageToMiddleware("stop_speech_transmission", null);				
					console.log("Speech transmission stopped");
					return true;
				} else {
					console.log("Stop speech failure");
					return false;
				}		
			} else {
				console.log("Hotspot has stopped receiving speech");
				return true;
			}			
		}
		
		function checkSpeechTransmissionStatus() {
			if(!PeerConnection || PeerConnection.iceConnectionState == "new"
				|| PeerConnection.iceConnectionState == "checking")
				return false;
			else if(PeerConnection.iceConnectionState == "closed") {
				PeerConnection = null;
				return false;
			}		
			else
				return true;
		}
		
		function resetSpeechTransmission(stream) {
			var ret = stopSpeechTransmission();
			if (ret === true) {
				console.log("Resetting speech transmission");				
				return startSpeechTransmission(stream);
			} else {
				console.log("Reset speech failure");
				return false;
			}				
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
        
        function registerWithSessionID(session_id){
            sendMessageToMiddleware("online", {"session": session_id});
        }  
        
		function updateSpeechMetaData(speech_info) {
			if (typeof speech_info !== "object") {
				console.log("Wrong speech info format. Update failure!");
				return false;
			} else {
				self.speech_info = speech_info;
				sendMessageToMiddleware("meta-data", speech_info);
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
		var PeerConnection, remoteVideo, remoteStream;
		
		this.setup = setupVideoDisplayObject;
		this.connect = connectMiddleware;
		this.wait = waitForSpeechTransmission;
		this.stop = stopSpeechTransmission;
		this.check = checkSpeechTransmissionStatus;
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
			if (checkSpeechTransmissionStatus() === true)
				sendMessageToMiddleware("stop_speech_transmission", null);
		};
		
		function setupVideoDisplayObject(remoteVideoObject) {
			self.remoteVideo = remoteVideoObject;
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
                    registerWithSessionID(connected_frame.headers.session);
                    
					var id = self.stomp.subscribe(receive_queue, 
						//Handling incoming messages
						function (message) {
							var signal = JSON.parse(message.body);
							if(signal.receiver !== 'hotspot' && signal.receiver !== 'all')
							{	
								return;
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
							else if(signal.type == "stop_speech_transmission") {
								stopSpeechTransmission(false);
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
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(x);
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
			if (typeof initiative === "undefined" || initiative === true) {
				if(self.PeerConnection && self.PeerConnection.signalingState != "closed") {
					self.PeerConnection.close();
					self.PeerConnection = null;			
					sendMessageToMiddleware("stop_speech_transmission", null);				
					console.log("Speech transmission stopped actively");
					return true;
				} else {
					console.log("Stop speech failure");
					return false;
				}	
			}
			else {
				if(self.PeerConnection) {
					self.PeerConnection.close();
					self.PeerConnection = null;
					console.log("Speech transmission stopped passively");
					return true;
				}
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
				'receiver': receiver,
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
        
		function registerWithSessionID(session_id){
            sendMessageToMiddleware("online", {"session": session_id});
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
					sendMessageToMiddleware('middleware',	'answer', {'sdp': description});
					console.log('Answer sdp generated');
				}, 
				function () { 
					console.log("Set local description error");
				}
			);  
		}
		
		function _gotLocalIceCandidate(event) {
			if (event.candidate) {
				sendMessageToMiddleware("middleware", 'ice-candidate', {'ice': event.candidate});
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










