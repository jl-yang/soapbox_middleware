'use strict'

var middleware = (function() {
    window.Soapbox = function(speech_info) {
        var self = this;
		var ws, stomp, send_queue;
		var PeerConnection, localStream;
		
		var PeerConnection_Config = {
			iceServers: [
			{
				url: "stun:stun.l.google.com:19302"
			},
			{
				url: "stun:stun.servers.mozilla.com"
			}]
		};
		
		var sdpConstraints = {
			optional: [],
			mandatory: {
				OfferToReceiveAudio: false,
				OfferToReceiveVideo: false
			}
		};
		
        this.speech_info = speech_info || {};
		
		this.connect = connectMiddleware;
		this.start = startSpeechTransmission;
		this.stop = stopSpeechTransmission;
		this.check = checkSpeechTransmissionStatus;
		this.reset = resetSpeechTransmission;
		this.send = sendMessageToMiddleware;
		this.update = updateSpeechMetaData;
		
		//Try to tell signaling server that it is about to close
		window.onbeforeunload = function(event) {
			sendMessageToMiddleware("relay-server", "stop_speech_transmission", null);
		};
		
		function connectMiddleware(onConnectCallback, onErrorCallback, onReceiveMessage, configuration) {
			//Parsing config params
			var configuration = configuration || {};
			var server_url = configuration.server_url || 'localhost:15674/stomp';
			send_queue = configuration.send_queue || "/exchange/logs";
			var receive_queue = configuration.receive_queue || "/exchange/logs";
			var user_name = configuration.user_name || 'guest';
			var password = configuration.password || 'guest';
			var vhost = configuration.vhost || '/';
			var debug = configuration.debug || false;
			
			//Stomp initialization
			ws = new SockJS(server_url);
			stomp = Stomp.over(ws);
			stomp.heartbeat.outgoing = 0;
			stomp.heartbeat.incoming = 0;
			if(!debug)
				stomp.debug = null;
			
			stomp.connect(user_name, password, 
				function(x) {
					var id = stomp.subscribe(receive_queue, 
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
								PeerConnection.close();
								PeerConnection = null;
								console.log("Speech transmission stopped");
							}
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});
					console.log("Connected to signaling server");
					//Send meta data of the speech, if any
					updateSpeechMetaData(speech_info);					
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(x);
			}, function(error) {
				console.log('Failed to connect to signaling server: ' + error.toString());
				return typeof onErrorCallback !== "function" ? null :onErrorCallback(error);
			}, vhost);
			
			
			
			return stomp;
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
						sendMessageToMiddleware("relay-server", "offer", {'sdp': description});
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
					sendMessageToMiddleware("relay-server", 'ice-candidate', {'ice': event.candidate});
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
			stomp.send(send_queue, {}, JSON.stringify(message_object));
		}
		
		function stopSpeechTransmission() {
			if(PeerConnection && PeerConnection.signalingState != "closed") {
				PeerConnection.close();
				PeerConnection = null;
			
				sendMessageToMiddleware("relay-server", "stop_speech_transmission", null);
				return true;
			} else {
				console.log("Stop speech failure");
				return false;
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
				sendMessageToMiddleware("relay-server", "meta-data", speech_info);
			} 
			
		}
		
    };
	
	window.Hotspot = function () {
		//add_like
		//add_dislike
		//report

	};
	
})();










