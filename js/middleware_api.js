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
		
		this.connect = connectMiddleware;
		this.submit = submitSpeechInfoBeforeSpeech;
		this.start = startSpeechTransmission;
		this.stop = stopSpeechTransmission;
		this.check = checkSpeechTransmissionStatus;
		this.reset = resetSpeechTransmission;
		this.send = sendMessageToMiddleware;
		this.update = updateSpeechMetaData;
		
		//Try to tell signaling server that it is about to close
		window.onbeforeunload = function(event) {
			sendMessageToMiddleware("hotspot", "stop_speech_transmission", null);
		};
		
		function submitSpeechInfoBeforeSpeech(speech_info) {
			if (typeof speech_info !== "object") {
				console.log("Wrong speech info format. Submit failure!");
				self.speech_info = {};
				return false;
			} else {
				self.speech_info = speech_info;
				sendMessageToMiddleware("hotspot", "meta-data", speech_info);
			}
		}
		
		function connectMiddleware(onConnectCallback, onErrorCallback, onReceiveMessage, configuration) {
			//Parsing config params
			var configuration = configuration || {};
			var server_url = configuration.server_url || 'localhost:15674/stomp';
			self.send_queue = configuration.send_queue || "/exchange/logs";
			var receive_queue = configuration.receive_queue || "/exchange/logs";
			var user_name = configuration.user_name || 'guest';
			var password = configuration.password || 'guest';
			var vhost = configuration.vhost || '/';
			var debug = configuration.debug || false;
			
			//Stomp initialization
			ws = new SockJS(server_url);
			self.stomp = Stomp.over(ws);
			self.stomp.heartbeat.outgoing = 0;
			self.stomp.heartbeat.incoming = 0;
			if(!debug)
				self.stomp.debug = null;
			
			self.stomp.connect(user_name, password, 
				function(x) {
					var id = self.stomp.subscribe(receive_queue, 
						//Handling incoming messages
						function(message) {
							var signal = JSON.parse(message.body);							
							if(signal.receiver !== 'soapbox')
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
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});
					console.log("Connected to signaling server");		
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(x);
			}, function(error) {
				console.log('Failed to connect to signaling server: ' + error.toString());
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
						sendMessageToMiddleware("hotspot", "offer", {'sdp': description});
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
					sendMessageToMiddleware("hotspot", 'ice-candidate', {'ice': event.candidate});
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
		
		function sendMessageToMiddleware(receiver, type, payload) {
			var message_object = {
				'sender': 'soapbox',
				'receiver': receiver,
				'timestamp': new Date().toISOString(),
				'type': type,
				'data': payload
			};
			if(self.stomp.connected !== true) {
				console.log("Connection to middleware is not on yet. Send failure.");
				return;
			} else {
				self.stomp.send(self.send_queue, {}, JSON.stringify(message_object));
			}
		}
		
		function stopSpeechTransmission(initiative) {
			if (typeof initiative === "undefined" || initiative === true) {
				if(PeerConnection && PeerConnection.signalingState != "closed") {
					PeerConnection.close();
					PeerConnection = null;			
					sendMessageToMiddleware("hotspot", "stop_speech_transmission", null);				
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
		
		function updateSpeechMetaData(speech_info) {
			if (typeof speech_info !== "object") {
				console.log("Wrong speech info format. Update failure!");
				return false;
			} else {
				self.speech_info = speech_info;
				sendMessageToMiddleware("hotspot", "meta-data", speech_info);
			} 			
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
		
		//Try to tell signaling server that it is about to close
		window.onbeforeunload = function(event) {
			sendMessageToMiddleware("soapbox", "stop_speech_transmission", null);
		};
		
		function setupVideoDisplayObject(remoteVideoObject) {
			self.remoteVideo = remoteVideoObject;
		}
		
		function connectMiddleware(onConnectCallback, onErrorCallback, onReceiveMessage, configuration) {
			//Parsing config params
			var configuration = configuration || {};
			var server_url = configuration.server_url || 'localhost:15674/stomp';
			self.send_queue = configuration.send_queue || "/exchange/logs";
			var receive_queue = configuration.receive_queue || "/exchange/logs";
			var user_name = configuration.user_name || 'guest';
			var password = configuration.password || 'guest';
			var vhost = configuration.vhost || '/';
			var debug = configuration.debug || false;
			
			//Stomp initialization
			self.ws = new SockJS(server_url);
			self.stomp = Stomp.over(self.ws);
			self.stomp.heartbeat.outgoing = 0;
			self.stomp.heartbeat.incoming = 0;
			if(!debug)
				self.stomp.debug = null;
			
			self.stomp.connect(user_name, password, 
				function(x) {
					var id = self.stomp.subscribe(receive_queue, 
						//Handling incoming messages
						function (message) {
							var signal = JSON.parse(message.body);	
							if(signal.receiver !== 'hotspot')
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
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});
					console.log("Connected to signaling server");		
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
					sendMessageToMiddleware("soapbox", "stop_speech_transmission", null);				
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
		
		function sendMessageToMiddleware(receiver, type, payload) {
			var message_object = {
				'sender': 'hotspot',
				'receiver': receiver,
				'timestamp': new Date().toISOString(),
				'type': type,
				'data': payload
			};
			if(self.stomp.connected !== true) {
				console.log("Connection to middleware is not on yet. Send failure.");
				return;
			} else {
				self.stomp.send(self.send_queue, {}, JSON.stringify(message_object));
			}
		}
		
		function addLike() {
			sendMessageToMiddleware("middleware", "like", {"hotspot": "test-hotspot"});
		}
		
		function addDislike() {
			sendMessageToMiddleware("middleware", "dislike", {"hotspot": "test-hotspot"});
		}
		
		function reportInappropriateContent() {
			sendMessageToMiddleware("middleware", "report", {"hotspot": "test-hotspot"});
		}
		
		
		
		
		
		
		
		
		
		
		//Local functions
		function _gotLocalDescription(description) {
			self.PeerConnection.setLocalDescription(
				description,	
				function () {
					sendMessageToMiddleware('soapbox',	'answer', {'sdp': description});
					console.log('Answer sdp generated');
				}, 
				function () { 
					console.log("Set local description error");
				}
			);  
		}
		
		function _gotLocalIceCandidate(event) {
			if (event.candidate) {
				sendMessageToMiddleware("soapbox", 'ice-candidate', {'ice': event.candidate});
				console.log('Local ICE candidate gathered');
			}
		}
		
		function _gotRemoteStream(event) {			
			console.log('Received remote stream');
			self.remoteStream = event.stream;
			self.remoteVideo.src = URL.createObjectURL(event.stream);
		}
	};
	
})();










