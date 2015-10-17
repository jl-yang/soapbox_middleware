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
        hotspot_id: null,
        createOffer: function(config) {
            var peer = new RTCPeerConnection(PeerConnection_Config);
            if(config.hotspot_id) {
                this.hotspot_id = config.hotspot_id;
            }
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
                    if (event.candidate !== null) {
                        //Don't disable ICE trickling
                        config.onicecandidate(event);       
                    }
                };
            }           
            peer.oniceconnectionstatechange = function(event) {
                //Nothing
            }
            
            var _desc = null;
            function gotLocalDescription() {           
                console.log("Got local description for hotspot_id:", config.hotspot_id);                      
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
                })},
                function (error) {
					console.log('Failed to create offer: ' + error.toString());
				},  
                config.sdpConstraints
            );
            this.peer = peer;
            //Use this to let the caller use the other methods when response is ready
            return this;
        },
        setRemoteDescription: function(sdp, onSuccess) {
            this.peer.setRemoteDescription(new RTCSessionDescription(sdp),
                onSuccess,
                function (error) {
                    console.log("setRemoteDescription error: ", error.toString());
            });
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
			OfferToReceiveAudio: false,
			OfferToReceiveVideo: false
		};		
        
        var peers = {};
        this.peers = peers;
        this.itself = "soapbox";
		this.connect = connectMiddleware;
		this.submit = submitSpeechInfo;
		this.update = submitSpeechInfo;
        this.register = registerInMiddleware; 
		this.start = startBroadcast;
        //This method should be explicitly invoked by the soapbox website
		this.stop = stopBroadcast;
		this.send = sendMessageToMiddleware;
		this.onreceivelikes = onReceiveLikesUpdate;
		this.onreceivedislikes = onReceiveDislikesUpdate;
		this.onreceivereports = onReceiveReportsUpdate;
		this.onreceivecomment = onReceiveComment;
        this.onreceivenextspeechinfo = onReceiveNextSpeechInfo;
        this.onreceivereservations = onReceiveReservations;
        this.onreceivecurrentspeechinfo = onReceiveCurrentSpeechInfo;
        this.onreceiveupcomingtodayspeech = onReceiveUpcomingTodaySpeech;
        
        this.all_speeches = RetrieveAllSpeechInfos;
        this.next_speech = RetrieveNextSpeechInfo;
        this.current_speech = RetrieveCurrentSpeechInfo;
        this.upcoming_speeches_today = RetrieveUpcomingSpeechesForToday;
        this.validate = ValidateIfPasswordIsForLatestSpeech;
        this.onvalidationresult = onReceiveValidationResult;
        
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
		
        function onReceiveComment(comment) {
            //None
        }
        
        function onReceiveReservations(reservations) {
            //None
        }
        
        function onReceiveNextSpeechInfo(speech_info) {
            //None
        }
        
        function onReceiveCurrentSpeechInfo(speech_info) {
            //None
        }
        
        function onReceiveUpcomingTodaySpeech(speeches) {
            //None
        }
        
        function RetrieveNextSpeechInfo() {
            sendMessageToMiddleware("next_speech_info", null);
        }
        
        function RetrieveCurrentSpeechInfo() {
            sendMessageToMiddleware("current_speech_info", null);
        }
        
        function ValidateIfPasswordIsForLatestSpeech(password) {
            sendMessageToMiddleware("validation", {"password": password});
        } 
        
        function RetrieveAllSpeechInfos() {
            sendMessageToMiddleware("speech_infos", null);
        }
        
        function RetrieveUpcomingSpeechesForToday() {
            sendMessageToMiddleware("upcoming_speeches_today", null);
        }
        
        function onReceiveValidationResult(result) {
            //result will be 0, 1, 2
            
        }
        
		function submitSpeechInfo(speech_info) {
			if (typeof speech_info !== "object") {
				console.log("Wrong speech info format. Submit failure!");
				self.speech_info = {};
				return false;
			} else {
				self.speech_info = speech_info;
				sendMessageToMiddleware("submit", {"speech_info": self.speech_info});
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
            self.ws = ws;
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
                                peers[signal.data.hotspot_id].setRemoteDescription(signal.data.sdp,
                                    function() {
                                        sendMessageToMiddleware("ready", null);
                                });						
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
                            else if (signal.type == "unregister" && signal.data.hotspot_id) {
                                if (typeof peers[signal.data.hotspot_id] !== "undefined") {
                                    delete peers[signal.data.hotspot_id];
                                }
                            }
							else if(signal.type == "likes" && signal.data.likes) {
								self.onreceivelikes(signal.data.likes);
							}
							else if(signal.type == "dislikes" && signal.data.dislikes) {
								self.onreceivedislikes(signal.data.dislikes);
							}
							else if(signal.type == "reports" && signal.data.reports) {
								self.onreceivereports(signal.data.reports);
							}
                            else if(signal.type == "comment" && signal.data.comment) {
                                self.onreceivecomment(signal.data.comment.username, signal.data.comment.content);
                            }
                            else if(signal.type == "speech_infos" && signal.data.speech_infos) {
                                self.onreceivereservations(signal.data.speech_infos);
                            }
                            else if(signal.type == "next_speech_info" && signal.data.next_speech_info) {
                                self.onreceivenextspeechinfo(signal.data.next_speech_info);
                            }
                            else if(signal.type == "current_speech_info" && signal.data.current_speech_info) {
                                self.onreceivecurrentspeechinfo(signal.data.current_speech_info);
                            }
                            else if(signal.type == "upcoming_today_speeches" && signal.data.upcoming_today_speeches) {
                                self.onreceiveupcomingtodayspeech(signal.data.upcoming_today_speeches);
                            }
                            else if(signal.type == "validation" && signal.data.validation) {
                                self.onvalidationresult(signal.data.validation);
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
		function startBroadcast(stream, speech_info) {
            localStream = stream;
            sendMessageToMiddleware("start_broadcast", typeof speech_info == "undefined" ? null : {"speech_info": speech_info});
        }
        
        function stopBroadcast() {
            sendMessageToMiddleware("stop_broadcast", null);
        }
        
        //Called when middleware sends a request_offer message. Offer will be requested only when new hotspot website is online
        function createOffer(hotspot_id) {
            var options = {
                "hotspot_id": hotspot_id,
                "stream": localStream,
                //Got local ice candidates
                "onicecandidate": function (event) {
                    sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'hotspot_id': hotspot_id});
                    
                },
                "gotLocalDescription": function (description) {      
                    sendMessageToMiddleware("offer", {'sdp': description, 'hotspot_id': hotspot_id});
                },
                "sdpConstraints": sdpConstraints
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
        
        function recordSpeechInBackground(video_element, stream_element, speech_time) {
            //resolutions
            var res = [];
            res["auto"] = {
                width: 0,
                height: 0
            }
            res["320"] = {
                width: 320,
                height: 240
            };
            res["480"] = {
                width: 640,
                height: 480
            };
            res["720"] = {
                width: 1280,
                height: 720
            };
            
            var recorder = new MultiStreamRecorder(stream_element);
            if (navigator.mozGetUserMedia) {
                recorder.mimeType = 'video/webm';
            }
            
            var videoBlobs = [];
            var audioBlobs = [];
            var videoType = "video/webm";
            var audioTypee = "audio/wav";
            
            recorder.video = video_element;
            
            recorder.canvas = res["auto"];
            
            recorder.ondataavailable = function(blobs) {
                videoBlobs.push(blobs.video);
                audioBlobs.push(blobs.audio);
                //Save streams
                var qqq = saveAs(blobs.video, "speech-video_" + new Date().toISOString() + ".webm");
                console.debug(qqq);
                console.debug("SaveAs done now");
                //saveAs(blobs.audio, "speech-audio_" + new Date().toISOString() + ".wav");
            };
            recorder.start(speech_time);
            
            setTimeout(function() {
                recorder.stop();
                
                //recorder.videoBlobs = [];
                //videoBlobs.forEach(function(blob) {
                //    var reader = new FileReader();
                //    reader.onload = function(event) {
                        //console.log(event.target.result);
                //    }
                //    reader.readAsDataURL(blob);
                //});
                    
            }, speech_time);
            
            return recorder;
		}
        
        //var reader = new FileReader();
                    //reader.onload = function(event) {
                    //    console.log(event.target.result);
                    //};
                    //reader.readAsDataURL(result);
                    
                    //Using sandbox file system
                    //http://www.html5rocks.com/en/tutorials/file/filesystem/
                    //Maybe using github pages to host the recorded streams
                    /* window.requestFileSystem  = window.requestFileSystem || window.webkitRequestFileSystem;
                    window.requestFileSystem(window.TEMPORARY, 1024 * 1024 * 100, function(fs) {
                        fs.root.getFile('test_video.webm', {create: true, exclusive: false}, 
                            function (fileEntry){
                                fileEntry.createWriter(function(fileWriter) {
                                    fileWriter.onwriteend = function(e){
                                        console.log("Write completed");
                                    };
                                    fileWriter.write(to_write_blob);
                            }, function(e) {console.log(e);})
                        },function(e) {console.log(e);});
                    }, function() {
                        console.log("error");
                    }); */
                    
                    
                    //var to_write_blob = result;                    
                    //console.log(bytesToSize(result.size));
                    //console.log(URL.createObjectURL(to_write_blob));
                        
                //});
                
                //reader.readAsDataURL(result);
                //console.log(bytesToSize(result.size));
                
        // below function via: http://goo.gl/B3ae8c
        function bytesToSize(bytes) {
            var k = 1000;
            var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            if (bytes === 0) return '0 Bytes';
            var i = parseInt(Math.floor(Math.log(bytes) / Math.log(k)), 10);
            return (bytes / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
        }
		
    };
    
    
    
	
	//API for Hotspot viewer website	
	window.Hotspot = function () {
		var self = this;
		var ws, stomp, send_queue;
		var PeerConnection, remoteVideo, remoteStream, hotspot_id;
		
        this.PeerConnection = PeerConnection;
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
		this.onreceivecomment = onReceiveComment;
        this.onreceivespeechinfo = onReceiveSpeechInfo;
        
        //Default handler
		function onReceiveLikesUpdate(likes) {
			//None
		}
		
		function onReceiveDislikesUpdate(dislikes) {
			//None
		}
		        
        function onReceiveComment(username, content) {
            //None
        }
		
        function onReceiveSpeechInfo(speech_info) {
            //None
            console.log(speech_info);
        }
        
		//Try to tell signaling server that it is about to close
		window.onbeforeunload = function(event) {
            sendMessageToMiddleware("unregister", {"hotspot_id": hotspot_id});
		};
		
		function setupVideoDisplayObject(remoteVideoObject) {
			self.remoteVideo = remoteVideoObject;
		}
		
        function registerInMiddleware(){
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
							if(signal.receiver !== 'hotspot')
							{	
								return;
							}					
                            if (typeof hotspot_id !== "undefined" && typeof signal.data !== "undefined"
                                && typeof signal.data.hotspot_id !== "undefined" 
                                && hotspot_id !== signal.data.hotspot_id) {
                                return;
                            }
                            if (signal.type == "register" && signal.data.hotspot_id) {
                                hotspot_id = signal.data.hotspot_id;
                                console.log("My hotspot id: ", hotspot_id);
                            }
							if (signal.type == "offer" && signal.data.sdp) {				
								waitForSpeechTransmission();						
								PeerConnection.setRemoteDescription(
                                    new RTCSessionDescription(signal.data.sdp), 
                                    function () {
                                        //Only after creating answer did peerconnection start gathering local ice
                                        PeerConnection.createAnswer(
                                            _gotLocalDescription, 
                                            function (error) {
                                                console.log('Failed to create answer: ' + error.toString());
                                        });
                                    },
                                    function (error) {
                                        console.log('Error: ' + error.toString());
                                });
							} 
							else if(signal.type == "ice-candidate" && signal.data.ice) {
								PeerConnection.addIceCandidate(new RTCIceCandidate(signal.data.ice));
							}
							else if(signal.type == "stop_broadcast") {
								stopSpeechTransmission();
							}
							else if(signal.type == "likes" && signal.data.likes) {
								self.onreceivelikes(signal.data.likes);
							}
							else if(signal.type == "dislikes" && signal.data.dislikes) {
								self.onreceivedislikes(signal.data.dislikes);
							}
							else if(signal.type == "comment" && signal.data.comment) {
                                self.onreceivecomment(signal.data.comment.username, signal.data.comment.content);
                            }
                            else if(signal.type == "current_speech_info" && signal.data.current_speech_info) {
                                self.onreceivespeechinfo(signal.data.current_speech_info);
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
			if(!PeerConnection) {
				PeerConnection = new RTCPeerConnection(PeerConnection_Config);
				console.log('Created local peer connection object PeerConnection');
                //Gathering local ice 
				PeerConnection.onicecandidate = function _gotLocalIceCandidate(event) {
                    if (event.candidate !== null) {
                        sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'hotspot_id': hotspot_id});
                        console.log('Local ICE candidate gathered');                        
                    }
                };
				PeerConnection.onaddstream = _gotRemoteStream;
				return true;
			}
			else {
				console.log("Transmission has already started.");
				return false;
			}
		}
		
		function stopSpeechTransmission(initiative) {
            if(PeerConnection && PeerConnection.signalingState != "closed") {
                PeerConnection.close();
                PeerConnection = null;						
                console.log("Speech transmission stopped");
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
			sendMessageToMiddleware("like", {"hotspot_id": hotspot_id});
		}
		
		function addDislike() {
			sendMessageToMiddleware("dislike", {"hotspot_id": hotspot_id});
		}
		
		function reportInappropriateContent() {
			sendMessageToMiddleware("report", {"hotspot_id": hotspot_id});
		}
		
		//Local functions
		function _gotLocalDescription(description) {
			PeerConnection.setLocalDescription(
				description,	
				function () {
					console.log('Answer sdp generated');
                    sendMessageToMiddleware('answer', {'sdp': description || PeerConnection.localDescription, 'hotspot_id': hotspot_id});
				}, 
				function () { 
					console.log("Set local description error");
				}
			);  
		}
		
		function _gotRemoteStream(event) {			
			console.log('Received remote stream');
			self.remoteStream = event.stream;
			self.remoteVideo.src = URL.createObjectURL(event.stream);
		}
	};
	
	
	//API for Audience who will comment on current speech 
    //Currently it is also used by ads website
	window.Audience = function () {
		var self = this;
		var ws, stomp, send_queue, temp_id;
		
        this.itself = "audience";
		this.connect = connectMiddleware;
		this.send = sendMessageToMiddleware;
		this.like = addLike;
		this.dislike = addDislike;
		this.report = reportInappropriateContent;
		this.onreceivelikes = onReceiveLikesUpdate;
		this.onreceivedislikes = onReceiveDislikesUpdate;
        this.onreceivespeechinfo = onReceiveSpeechInfo;
		this.comment = addCommentToCurrentSpeech;
        this.submit = submitSpeechInfo;
        this.get_speech_info = getCurrentSpeechInfo;
        
        //Default handler
		function onReceiveLikesUpdate(likes) {
			//None
		}
		
		function onReceiveDislikesUpdate(dislikes) {
			//None
		}
		        
        function onReceiveSpeechInfo(speech_info) {
            //None
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
        
        function getCurrentSpeechInfo() {
            //This will cause middleware to send "submit" speech info to audience
            sendMessageToMiddleware("current_speech_info");
        }
        
        function submitSpeechInfo(speech_info) {
            sendMessageToMiddleware("submit", {"speech_info": speech_info});
        }
        
        function addLike() {
			sendMessageToMiddleware("like");
		}
		
		function addDislike() {
			sendMessageToMiddleware("dislike");
		}
		
		function reportInappropriateContent() {
			sendMessageToMiddleware("report");
		}
        
        function addCommentToCurrentSpeech(username, comment) {
            //Comments should be just plain string
            sendMessageToMiddleware("comment", {"comment": {"username": username, "content": comment}});
        }
        
		function connectMiddleware(onConnectCallback, onErrorCallback, onReceiveMessage, configuration) {
			//Parsing config params
			var configuration = configuration || {};
			var server_url = configuration.server_url || 'bunny.ubioulu.fi:15674/stomp';
			self.send_queue = configuration.send_queue || "/exchange/soapbox/middleware";
			var receive_queue = configuration.receive_queue || "/exchange/soapbox/audience";
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
							if(signal.receiver !== 'audience')
							{	
								return;
							}
                            
							if(signal.type == "likes") {
								self.onreceivelikes(signal.data.likes);
							}
							else if(signal.type == "dislikes") {
								self.onreceivedislikes(signal.data.dislikes);
							}	
                            else if(signal.type == "submit") {
                                self.onreceivespeechinfo(signal.data.speech_info);
                            }
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});                    
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(connected_frame);
                }, function(error) {
                    console.log('Failed to connect to middleware: ' + error.toString());
                    return typeof onErrorCallback !== "function" ? null :onErrorCallback(error);
                }, vhost);			
		}
	};
	
})();










