'use strict'

var middleware = (function() {
	
	//Reusable stuff
    
    /*Useful for extracting date and time separately from a date_time_string
    example string: "25/11/2015 12:00" ("%d/%m/%Y %H:%M")
    options: {"day": true, "hour": true}
    return: {"date": "25/11/2015", "time": "12:00"}
    */
    window.current_time_string = function() {
        var now = new Date();
        var year = "" + now.getFullYear();
        var month = "" + (now.getMonth() + 1); if (month.length == 1) { month = "0" + month; }
        var day = "" + now.getDate(); if (day.length == 1) { day = "0" + day; }
        var hour = "" + now.getHours(); if (hour.length == 1) { hour = "0" + hour; }
        var minute = "" + now.getMinutes(); if (minute.length == 1) { minute = "0" + minute; }
        return day + "/" + month + "/" + year + " " + hour + ":" + minute;
    };
    
    window.extract_date_time = function(date_time_string, options) {
        var response = {};
        
        var res = date_time_string.split(" ");
        
        //First contains day, month, year. Second contains hour, minute
        response.date = res[0];
        response.time = res[1];
        
        var res_1 = res[0].split("/");
        var day = res_1[0];
        var month = res_1[1];
        var year = res_1[2];
        
        var res_2 = res[1].split("/");
        //res_2 hour+minute
        var res_3 = res_2[0].split(":");
        
        var hour = res_3[0];
        var minute = res_3[1];
        
        if(typeof options == "undefined") {
            return response;
        }
        if(options.day) {
            response.day = day;
        }
        if(options.month) {
            response.month = month;
        }
        if(options.year) {
            response.year = year;
        }
        if(options.hour) {
            response.hour = hour;
        }
        if(options.minute) {
            response.minute = minute;
        }
        
        return response;
    };
    
    var PeerConnection_Config = {
		iceServers: [
		{
			url: "stun:stun.l.google.com:19302"
		},
        {
			url: "stun:stun1.l.google.com:19302"
		},
        {
			url: "stun:stun2.l.google.com:19302"
		},
        {
			url: "stun:stun3.l.google.com:19302"
		}]
	};	
    
    // for Chrome:
    var sdpConstraintsTest = {
        optional: [],
        mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: true
        }
    };
    
    var sdpConstraintsForHotspot = {
        optional: [],
        mandatory: {
            OfferToReceiveAudio: false,
            OfferToReceiveVideo: false
        }
    }
    
    var sdpConstraints = sdpConstraintsForHotspot;
    
    var error = function(error) {
        console.error(error);
    }
    
    var Offer = {
        createOffer: function(config) {   
            var peer = new RTCPeerConnection(PeerConnection_Config);
            if(config.hotspot_id) {
                console.log("Creating an offer for hotspot_id:", config.hotspot_id);
            }
            else if (config.virtual_id) {
                console.log("Creating an offer for virtual_id:", config.virtual_id);
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
            if (config.onaddstream) {
                peer.onaddstream = config.onaddstream;
            }
            
            var _desc = null;
            function gotLocalDescription() {           
                console.log("Got local description");                      
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
        },
        setRemoteDescription: function(sdp, onSuccess) {
            this.peer.setRemoteDescription(new RTCSessionDescription(sdp),
                onSuccess,
                function (error) {
                    console.log("setRemoteDescription error: ", error.toString());
            });
        },
    };
    
	//API for Soapbox website
	window.Soapbox = function() {
        var self = this, soapbox_id;
		var ws, stomp, send_queue;
		var localStream, speech_info;
				
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
		this.onreceivelikes = function onReceiveLikesUpdate(likes) {};
		this.onreceivedislikes = function onReceiveDislikesUpdate(dislikes) {};
		this.onreceivereports = function onReceiveReportsUpdate(reports) {};        
		this.onreceivecomment = function onReceiveComment(comment) {};
        this.onreceivenextspeechinfo = function onReceiveNextSpeechInfo(speech_info) {};
        this.onreceiveallspeeches = function onReceiveAllSpeeches(speeches) {};
        this.onreceivecurrentspeechinfo = function onReceiveCurrentSpeechInfo(speech_info) {};
        this.onreceiveupcomingtodayspeech = function onReceiveUpcomingTodaySpeech(speeches) {};
        
        this.all_speeches = RetrieveAllSpeechInfos;
        this.next_speech = RetrieveNextSpeechInfo;
        this.current_speech = RetrieveCurrentSpeechInfo;
        this.upcoming_speeches_today = RetrieveUpcomingSpeechesForToday;
        this.validate = ValidateIfPasswordIsForLatestSpeech;
        this.onvalidationresult = onReceiveValidationResult;
        this.delete_speech = DeleteSpeechBasedOnPassword;
        this.ondeletespeech = onDeleteSpeech;
        
        this.onreceivecurrentusers = function onReceiveCurrentUsers(count) {};
        this.onreceivestartfeedback = function onReceiveStartFeedback() {};
        
        this.onaddhotspotstream = function(event) {};
        this.onaddvirtualstream = function(event) {};
        
        
		//Record API
		this.record = recordSpeechInBackground;
		
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
        
        function DeleteSpeechBasedOnPassword(password) {
            sendMessageToMiddleware("delete_speech", {"password": password});
        }
        
        function onReceiveValidationResult(result) {
            //result will be 0, 1, 2
            
        }      
        
        function onDeleteSpeech(success) {
            //success will be true or false
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
        
        function onMessage(type, data) {
            if (type == "register" && data != null && typeof data.soapbox_id != "undefined") {
                console.debug("Soapbox id: ", data.soapbox_id);
                self.soapbox_id = data.soapbox_id;
            }   
            //Assume soapbox will fire the offer according to middleware's request
            else if (type == "answer" && data != null && typeof data.sdp != "undefined") {
                
                console.debug(peers[data.hotspot_id]);
                
                if (typeof data.virtual_id != "undefined") {
                    peers[data.virtual_id].setRemoteDescription(data.sdp,
                        function() {
                            sendMessageToMiddleware("ready", null);
                    });					
                } else if (typeof data.hotspot_id != "undefined") {
                    peers[data.hotspot_id].setRemoteDescription(data.sdp,
                        function() {
                            sendMessageToMiddleware("ready", null);
                    });	
                } 
            } 
            //From virtual receiver
            else if(type == "ice-candidate" && data != null 
                && typeof data.ice != "undefined" && typeof data.virtual_id != "undefined") {
                peers[data.virtual_id].addIceCandidate(data.ice);
            } 
            else if(type == "ice-candidate" && data != null 
                && typeof data.ice != "undefined" && typeof data.hotspot_id != "undefined") {
                peers[data.hotspot_id].addIceCandidate(data.ice);
            } 
            else if(type == "stop_broadcast" && data != null && typeof data.hotspot_id != "undefined") {
                peers[data.hotspot_id].stopSpeech();
            }
            else if(type == "stop_broadcast" && data != null && typeof data.virtual_id != "undefined") {
                peers[data.virtual_id].stopSpeech();
            }
            else if (type == "start_feedback" && data != null && typeof data.start_feedback != "undefined") {
                self.onreceivestartfeedback(data.start_feedback)
            }
            else if (type == "request_offer") {                
                if (data.virtual_id)
                    createOffer(data.virtual_id, "virtual");
                else if(data.hotspot_id)
                    createOffer(data.hotspot_id, "hotspot");
            }
            else if (type == "unregister" && data != null && typeof data.hotspot_id != "undefined") {
                if (typeof peers[data.hotspot_id] !== "undefined") {
                    delete peers[data.hotspot_id];
                }
            }
            else if (type == "unregister" && data != null && typeof data.virtual_id != "undefined") {
                if (typeof peers[data.virtual_id] !== "undefined") {
                    delete peers[data.virtual_id]
                }
            }
            else if(type == "likes" && data != null && typeof data.likes != "undefined") {
                self.onreceivelikes(data.likes);
            }
            else if(type == "dislikes" && data != null && typeof data.dislikes != "undefined") {
                self.onreceivedislikes(data.dislikes);
            }
            else if(type == "reports" && data != null && typeof data.reports != "undefined") {
                self.onreceivereports(data.reports);
            }
            else if(type == "comment" && data != null && typeof data.comment != "undefined") {
                self.onreceivecomment(data.comment.username, data.comment.content);
            }
            else if(type == "speech_infos" && data != null && typeof data.speech_infos != "undefined") {
                self.onreceiveallspeeches(data.speech_infos);
            }
            else if(type == "next_speech_info" && data != null && typeof data.next_speech_info != "undefined") {
                self.onreceivenextspeechinfo(data.next_speech_info);
            }
            else if(type == "current_speech_info" && data != null && typeof data.current_speech_info != "undefined") {
                self.onreceivecurrentspeechinfo(data.current_speech_info);
            }
            else if(type == "upcoming_today_speeches" && data != null && typeof data.upcoming_today_speeches != "undefined") {
                self.onreceiveupcomingtodayspeech(data.upcoming_today_speeches);
            }
            else if(type == "validation" && data != null && typeof data.validation != "undefined") {
                self.onvalidationresult(data.validation);
            }
            else if(type == "delete_speech" && data != null && typeof data.delete_speech != "undefined") {
                self.ondeletespeech(data.delete_speech);
            }
            else if (type == "current_users" && data != null && typeof data.current_users != "undefined") {
                self.onreceivecurrentusers(data.current_users);
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
							
                            onMessage(signal.type, (typeof signal.data !== "function" ? signal.data : null));
                            
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
            sendMessageToMiddleware("stop_broadcast", {"soapbox_id": self.soapbox_id});
        }
        
        //Called when middleware sends a request_offer message.
        function createOffer(receiver_id, receiver) {
            var options = null;
            if (receiver == "virtual") {
                options = {
                    "virtual_id": receiver_id,
                    "stream": localStream,
                    //Got local ice candidates
                    "onicecandidate": function (event) {
                        sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'receiver_id': receiver_id});                        
                    },
                    "gotLocalDescription": function (description) {      
                        sendMessageToMiddleware("offer", {'sdp': description, 'receiver_id': receiver_id});
                    },
                    "sdpConstraints": sdpConstraints
                }; 
            } else if (receiver == "hotspot") {
                options = {
                    "hotspot_id": receiver_id,
                    "stream": localStream,
                    //Got local ice candidates
                    "onicecandidate": function (event) {
                        sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'hotspot_id': receiver_id});                        
                    },
                    "gotLocalDescription": function (description) {      
                        sendMessageToMiddleware("offer", {'sdp': description, 'hotspot_id': receiver_id});
                    },
                    "sdpConstraints": sdpConstraintsTest,
                    "onaddstream": self.onaddhotspotstream
                };   
            }
            peers[receiver_id] = Offer.createOffer(options);			
		}
                
        function sendMessageToMiddleware(type, payload) {     
            var message_object = {
                'sender': self.itself,
                'receiver': "middleware",
                'timestamp': (new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000)).toISOString(),
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
                var qqq = saveAs(blobs.video, "speech-video_" + (new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000)).toISOString() + ".webm");
                console.debug(qqq);
                console.debug("SaveAs done now");
                //saveAs(blobs.audio, "speech-audio_" + new Date().toISOString() + ".wav");
            };
            recorder.start(speech_time);
            
            setTimeout(function() {
                recorder.stop();
                
            }, speech_time);
            
            return recorder;
		}
                
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
		var PeerConnection, remoteVideo, remoteStream, localStream, hotspot_id;
		
        this.PeerConnection = PeerConnection;
        this.itself = "hotspot";
		this.setup = setupVideoDisplayObject;
		this.connect = connectMiddleware;
        this.register = registerInMiddleware;
		this.send = sendMessageToMiddleware;
		this.like = addLike;
		this.dislike = addDislike;
		this.report = reportInappropriateContent;
		this.onreceivelikes = function onReceiveLikesUpdate(likes) {};
		this.onreceivedislikes = function onReceiveDislikesUpdate(dislikes) {};
        this.onreceivereports = function onReceiveReportsUpdate(reports) {};
		this.onreceivecomment = function onReceiveComment(username, content) {};
        this.onreceivespeechinfo = function onReceiveSpeechInfo(speech_info) {};
        
        this.onreceivecurrentusers = function onReceiveCurrentUsers(count) {};
        
        this.addStream = function(stream){
            //Save local stream object so that it could be added for future offers for virtual
            self.localStream = stream;
            
            waitForSpeechTransmission();
            PeerConnection.addStream(stream);
        };
        
        //For sending streams to virtual
        var peers = {};
        var streams = {};
        this.peers = peers;
        this.streams = streams;
        
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
        
        //Called when middleware sends a request_offer_virtual message.
        function createOffer(virtual_id) {
            var options = {
                "virtual_id": virtual_id,
                "stream": self.localStream,
                //Got local ice candidates
                "onicecandidate": function (event) {
                    sendMessageToMiddleware('ice-candidate_hotspot', {'ice': event.candidate, "hotspot_id": hotspot_id, 'receiver_id': virtual_id});                    
                },
                "gotLocalDescription": function (description) {      
                    sendMessageToMiddleware("offer_hotspot", {'sdp': description, 'hotspot_id': hotspot_id, 'receiver_id': virtual_id});
                },
                "sdpConstraints": sdpConstraintsTest
            };   
            
            peers[virtual_id] = Offer.createOffer(options);			
		}
        
        function onMessage(type, data) {
            if (type == "register" && data != null && typeof data.hotspot_id != "undefined") {
                hotspot_id = data.hotspot_id;
                console.info("My hotspot id: ", hotspot_id);
            }
            
            //For sending hotspot streams to virtual
            else if (type == "request_offer_virtual" && data != null && typeof data.virtual_id !== "undefined") {
                createOffer(data.virtual_id);
            }
            
            //Either answer or remote ice comes first 
            else if (type == "answer_hotspot" && data != null && typeof data.sdp !== "undefined"
                && typeof data.virtual_id !== "undefined") {
                console.debug("Got remote sdp from virtual:", data.sdp);
                peers[data.virtual_id].setRemoteDescription(data.sdp,
                    function() {
                        sendMessageToMiddleware("ready_hotspot", null);
                });		
            }
            
            //ice would come later than request_offer_virtual
            else if (type == "ice-candidate_hotspot" && data != null && typeof data.ice !== "undefined"
                && typeof data.virtual_id !== "undefined") {
                peers[data.virtual_id].addIceCandidate(data.ice);
            }
            
            //start speech from a virtual user now
            else if (type == "start_broadcast_virtual" && data != null && typeof data.virtual_id !== "undefined") {
                self.remoteVideo.src = URL.createObjectURL(self.streams[data.virtual_id]);
            }
            
            //stop speech from a virtual user now
            else if (type == "stop_broadcast_virtual" && data != null && typeof data.virtual_id !== "undefined") {
                self.remoteVideo.src = null;
            }
            //clean up when a virtual is offline
            else if (type == "unregister_virtual" && data != null && typeof data.virtual_id !== "undefined") {
                if (data.virtual_id in self.streams) {
                    delete self.streams[data.virtual_id]
                    //stop connection first
                    self.peers[data.virtual_id].close();
                    delete self.peers[data.virtual_id]
                }                                    
            }
            
            else if (type == "offer" && data != null && typeof data.sdp != "undefined") {	
                //Either offer or an ice candidate comes first
                waitForSpeechTransmission();		
                PeerConnection.setRemoteDescription(
                    new RTCSessionDescription(data.sdp), 
                    function () {
                        //Only after creating answer did peerconnection start gathering local ice
                        PeerConnection.createAnswer(
                            _gotLocalDescription, 
                            function (error) {
                                console.log('Failed to create answer: ' + error.toString());
                        }, sdpConstraintsTest);
                    },
                    function (error) {
                        console.log('Error: ' + error.toString());
                });
            } 
            else if(type == "ice-candidate" && data != null && typeof data.ice != "undefined") {
                //Either offer or an ice candidate comes first
                waitForSpeechTransmission();		
                PeerConnection.addIceCandidate(new RTCIceCandidate(data.ice));
            }
            //From virtual speaker
            else if(type == "stop_broadcast") {
                stopSpeechTransmission();
            }
            else if(type == "likes" && data != null && typeof data.likes != "undefined") {
                self.onreceivelikes(data.likes);
            }
            else if(type == "dislikes" && data != null && typeof data.dislikes != "undefined") {
                self.onreceivedislikes(data.dislikes);
            }
            else if (type == "reports" && data != null && typeof data.reports != "undefined") {
                self.onreceivereports(data.reports);
            }
            else if(type == "comment" && data != null && typeof data.comment != "undefined") {
                self.onreceivecomment(data.comment.username, data.comment.content);
            }
            else if(type == "current_speech_info" && data != null && typeof data.current_speech_info != "undefined") {
                self.onreceivespeechinfo(data.current_speech_info);
            }
            else if (type == "current_users" && data != null && typeof data.current_users != "undefined") {
                self.onreceivecurrentusers(data.current_users);
            }
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
                            
                            //parse the messages
                            onMessage(signal.type, (typeof signal.data !== "undefined" ? signal.data : null));
                            
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});                    
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(connected_frame);
                }, function(error) {
                    console.warn('Failed to connect to signaling server: ' + error.toString());
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
                if (self.localStream != null) {
                    PeerConnection.addStream(self.localStream);
                }                
			}
		}
		
		function stopSpeechTransmission() {
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
				'timestamp': (new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000)).toISOString(),
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
            console.log(event);
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
        this.online = addMyselfToActiveUsers;
        this.offline = deleteMyselfFromActiveUsers;
		this.send = sendMessageToMiddleware;
		this.like = addLike;
		this.dislike = addDislike;
		this.report = reportInappropriateContent;
		this.onreceivelikes = onReceiveLikesUpdate;
		this.onreceivedislikes = onReceiveDislikesUpdate;
        this.onreceivereports = onReceiveReportsUpdate;
        this.onreceivespeechinfo = onReceiveSpeechInfo;
		this.comment = addCommentToCurrentSpeech;
        this.submit = submitSpeechInfo;
        this.get_speech_info = getCurrentSpeechInfo;
        this.delete_speech = DeleteSpeechBasedOnPassword;
        this.ondeletespeech = onDeleteSpeech;
        this.onreceivecurrentusers = onReceiveCurrentUsers;
        
        //Default handler
		function onReceiveCurrentUsers(count) {
            //None
        }
        
        function onReceiveLikesUpdate(likes) {
			//None
		}
		
		function onReceiveDislikesUpdate(dislikes) {
			//None
		}
        
        function onReceiveReportsUpdate(reports) {
            //None
        }
        
        function onReceiveSpeechInfo(speech_info) {
            //None
        }
        
        function onDeleteSpeech(success) {
            //success will be true or false
        }
        
        function sendMessageToMiddleware(type, payload) {
			var message_object = {
				'sender': self.itself,
				'receiver': "middleware",
				'timestamp': (new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000)).toISOString(),
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
        
        function addMyselfToActiveUsers() {
            sendMessageToMiddleware("online");
        }
        
        function deleteMyselfFromActiveUsers() {
            sendMessageToMiddleware("offline");
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
        
        function DeleteSpeechBasedOnPassword(password) {
            sendMessageToMiddleware("delete_speech", {"password": password});
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
                            else if (signal.type == "reports") {
                                self.onreceivereports(signal.data.reports);
                            }
                            else if(signal.type == "current_speech_info") {
                                self.onreceivespeechinfo(signal.data.current_speech_info);
                            }
                            else if(signal.type == "delete_speech" && signal.data.delete_speech) {
                                self.ondeletespeech(signal.data.delete_speech);
                            }
                            else if (signal.type == "current_users" && signal.data.current_users) {
                                self.onreceivecurrentusers(signal.data.current_users);
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
	
    //API for Virtual soapbox
	window.Virtual = function(name) {
        var self = this;
		var ws, stomp, send_queue;
		var PeerConnection, remoteVideo, remoteStream, virtual_id;//PeerConnection is for receiver role
		                
        //From soapbox related
        var localStream, speech_info;        
                
        var peers = {};
        this.peers = peers;
        window.peers = peers;
        
        //For hotspots
        var peers_hotspots = {};
        this.peers_hotspots = peers_hotspots;
        
        this.PeerConnection = PeerConnection;
        
        this.itself = "virtual";
        this.name = typeof name !== "undefined" ? name : "unknown-virtual";
        
		this.setup = function setupVideoDisplayObject(remoteVideoObject) {
			self.remoteVideo = remoteVideoObject;
		};
        
		this.connect = connectMiddleware;
        
        this.register = function registerInMiddleware(){
            sendMessageToMiddleware("register", {"name": self.name});
        };
        
        this.start = startBroadcast;
        
        //Only for speaker
        this.stop = stopBroadcast;  
        
        this.send = sendMessageToMiddleware;
        
		this.like = function addLike() {
			sendMessageToMiddleware("like", {"virtual_id": virtual_id});
		};
        
		this.dislike = function addDislike() {
			sendMessageToMiddleware("dislike", {"virtual_id": virtual_id});
		};
        
        //Comments should be just plain string
        this.comment = function addCommentToCurrentSpeech(username, comment) {            
            sendMessageToMiddleware("comment", {"comment": {"username": username, "content": comment}, "virtual_id": self.virtual_id});
        };
        
		this.report = function reportInappropriateContent() {
			sendMessageToMiddleware("report", {"virtual_id": virtual_id});
		};
        
		this.onreceivelikes = function onReceiveLikesUpdate(likes) {};        
		this.onreceivedislikes = function onReceiveDislikesUpdate(dislikes) {};
        this.onreceivereports = function onReceiveReportsUpdate(reports) {};
		this.onreceivecomment = function onReceiveComment(username, content) {};        
        this.onreceivespeechinfo = function onReceiveSpeechInfo(speech_info) {console.log(speech_info);};        
        this.onregister = function onRegister() {};        
        this.onreceivestartfeedback = function onReceiveStartFeedback() {};        
        this.onstopspeech = function onStopSpeech() {};        
        this.onreceivecurrentusers = function onReceiveCurrentUsers(count) {};
        this.onaddhotspotstream = function onAddHotspotStream(event) {};
        
        window.onbeforeunload = function(event) {
            unregisterItself();
		};
        
        //Try to tell signaling server that it is about to leave watching the virtual soapbox 
		function unregisterItself() {
            sendMessageToMiddleware("unregister", {"virtual_id": virtual_id});
		};
        
        //Parsing messages
        function onMessage(type, data) {
            if (type == "register" && data != null && typeof data.receiver_id != "undefined" && typeof virtual_id == "undefined" 
                && typeof data.name !== "undefined" && data.name == self.name) {
                virtual_id = data.receiver_id;
                console.log("My virtual id: ", virtual_id);
                self.onregister();
                
                //This if for getting hotspot streams, different from broadcasting speech if such virtual is a speaker
            }
            
            //Act as receiver
            else if (type == "offer" && data != null && typeof data.sdp != "undefined") {				
                waitForSpeechTransmission();		
                PeerConnection.setRemoteDescription(
                    new RTCSessionDescription(data.sdp), 
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
            
            //Act as receiver for hotspot stream, middleware will send it to all hotspots using offers from all online virtual
            else if (type == "offer_hotspot" && data != null && typeof data.sdp !== "undefined" && typeof data.hotspot_id !== "undefined"){
                //Create new RTCPeerConnection instance
                waitForHotspotStream(data.hotspot_id);
                
                self.peers_hotspots[data.hotspot_id].setRemoteDescription(
                    new RTCSessionDescription(data.sdp), 
                    function (){
                        console.debug("Success set remote description");
                    }, 
                    error
                );            
                
                self.peers_hotspots[data.hotspot_id].createAnswer(function (answer) {
                        self.peers_hotspots[data.hotspot_id].setLocalDescription(answer, function () {
                            console.debug(self.peers_hotspots[data.hotspot_id]);
                            sendMessageToMiddleware('answer_hotspot', {'sdp': answer || self.peers_hotspots[data.hotspot_id].localDescription, "hotspot_id": data.hotspot_id, 'virtual_id': virtual_id});
                        }, error);
                    }, 
                    error,
                    sdpConstraintsTest
                );
            } 
            
            //add ice from hotspot stream
            else if (type == "ice-candidate_hotspot" && data != null && typeof data.ice !== "undefined" && typeof data.hotspot_id !== "undefined") {
                //in case new RTCPeerConnection instance is not created yet
                waitForHotspotStream(data.hotspot_id);
                
                self.peers_hotspots[data.hotspot_id].addIceCandidate(new RTCIceCandidate(data.ice));
            }
            
            //From speaker, important to decide if virtual id is non-existing
            else if(type == "ice-candidate" && data != null && typeof data.ice != "undefined"
                && typeof data.virtual_id == "undefined" && typeof data.hotspot_id == "undefined") {
                PeerConnection.addIceCandidate(new RTCIceCandidate(data.ice));
            }
            
            //From virtual receiver
            else if (type == "answer" && data != null && typeof data.sdp != "undefined") {
                if (typeof data.virtual_id != "undefined") {
                    peers[data.virtual_id].setRemoteDescription(data.sdp,
                        function() {
                            sendMessageToMiddleware("ready", {"virtual_id": virtual_id});
                    });					
                } else if (typeof data.hotspot_id != "undefined") {
                    peers[data.hotspot_id].setRemoteDescription(data.sdp,
                        function() {
                            sendMessageToMiddleware("ready", null);
                    });	
                }                                    
            } 
            //From virtual receiver
            else if(type == "ice-candidate" && data != null && typeof data.ice != "undefined" && typeof data.virtual_id != "undefined") {
                peers[data.virtual_id].addIceCandidate(data.ice);
                console.debug("Receiving ice-candidate", data.ice);
            } 
            //From hotspot receiver
            else if(type == "ice-candidate" && data != null && typeof data.ice && typeof data.hotspot_id != "undefined") {
                peers[data.hotspot_id].addIceCandidate(data.ice);
            } 
            //From middleware
            else if (type == "request_offer") {
                if (data.virtual_id)
                    createOffer(data.virtual_id, "virtual");
                else if(data.hotspot_id)
                    createOffer(data.hotspot_id, "hotspot");
            }
            else if (type == "current_users" && data != null && typeof data.current_users != "undefined") {
                self.onreceivecurrentusers(data.current_users);
            }                            
            //From virtual speaker
            else if(type == "stop_broadcast" && data != null
                && typeof data.virtual_id !== "undefined"
                && data.virtual_id !== self.virtual_id) {
                stopSpeechTransmission();                                
            }
            //From soapbox speaker
            else if (type == "stop_broadcast") {
                stopSpeechTransmission();
                self.onstopspeech();
            }                                
            //From virtual receiver
            else if (type == "unregister" && data != null && typeof data.virtual_id != "undefined") {
                if (typeof peers[data.virtual_id] !== "undefined") {
                    peers[data.virtual_id].stopSpeech();
                    delete peers[data.virtual_id];
                }
            }
            else if (type == "unregister" && data != null && typeof data.hotspot_id != "undefined") {
                if (typeof peers[data.hotspot_id] !== "undefined") {
                    peers[data.hotspot_id].stopSpeech();
                    delete peers[data.hotspot_id];
                }
            } 
            else if (type == "start_feedback" && data != null && typeof data.start_feedback != "undefined") {
                self.onreceivestartfeedback(data.start_feedback)
            }
            else if(type == "likes" && data != null && typeof data.likes != "undefined") {
                self.onreceivelikes(data.likes);
            }
            else if(type == "dislikes" && data != null && typeof data.dislikes != "undefined") {
                self.onreceivedislikes(data.dislikes);
            }
            else if (type == "reports" && data != null && typeof data.reports != "undefined") {
                self.onreceivereports(data.reports);
            }
            else if(type == "comment" && data != null && typeof data.comment != "undefined") {
                self.onreceivecomment(data.comment.username, data.comment.content);
            }
            else if(type == "current_speech_info") {
                self.onreceivespeechinfo(data.current_speech_info);
            }
        }
        
        function waitForHotspotStream(hotspot_id) {
            if (!(hotspot_id in self.peers_hotspots)) {
                self.peers_hotspots[hotspot_id] = new RTCPeerConnection(PeerConnection_Config);
                                
                self.peers_hotspots[hotspot_id].onicecandidate = function (event) {
                    console.debug("an ice generated:", event.candidate);
                    if (event.candidate != null){
                        sendMessageToMiddleware("ice-candidate_hotspot", {"ice": event.candidate, "hotspot_id": hotspot_id, "virtual_id": virtual_id});
                    }
                }                
                self.peers_hotspots[hotspot_id].onaddstream = self.onaddhotspotstream;
            }
        }
        
		function connectMiddleware(onConnectCallback, onErrorCallback, onReceiveMessage, configuration) {
			//Parsing config params
			var configuration = configuration || {};
			var server_url = configuration.server_url || 'bunny.ubioulu.fi:15674/stomp';
			self.send_queue = configuration.send_queue || "/exchange/soapbox/middleware";
			var receive_queue = configuration.receive_queue || "/exchange/soapbox/virtual";
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
							if(signal.receiver !== 'virtual')
							{	
                                console.log("Messages routing error!");
								return signal;
							}		
                            //If it is not for me, then ignore it
                            if (typeof virtual_id !== "undefined" && typeof signal.data !== "undefined"
                                && typeof signal.data.receiver_id !== "undefined" 
                                && virtual_id !== signal.data.receiver_id) {
                                console.debug("Not for me");
                                return;
                            }                            
                            
                            onMessage(signal.type, typeof signal.data !== "undefined" ? signal.data : null);
                            
							return typeof onReceiveMessage !== "function" ? null : onReceiveMessage(signal);
					});	
					return typeof onConnectCallback !== "function" ? null : onConnectCallback(connected_frame);
			}, function(error) {
				console.warn(error.toString());
				return typeof onErrorCallback !== "function" ? null :onErrorCallback(error);
			}, vhost);
			
		}
            
		function stopSpeechTransmission() {
            console.log("Stopping speech transmission now")
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
        
        function waitForSpeechTransmission() {
            console.debug(PeerConnection);
            console.debug(PeerConnection_Config);
			if(!PeerConnection) {
				PeerConnection = new RTCPeerConnection(PeerConnection_Config);
				console.log('Created local peer connection object PeerConnection');
                //Gathering local ice 
				PeerConnection.onicecandidate = function _gotLocalIceCandidate(event) {
                    if (event.candidate !== null) {
                        sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'virtual_id': virtual_id});
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
        
        //Local functions
		function _gotLocalDescription(description) {
			PeerConnection.setLocalDescription(
				description,	
				function () {
					console.log('Answer sdp generated');
                    sendMessageToMiddleware('answer', {'sdp': description || PeerConnection.localDescription, 'virtual_id': virtual_id});
				}, 
				function () { 
					console.log("Set local description error");
				}
			);  
		}
        
        function _gotRemoteStream(event) {			
			console.log('Received remote stream');
            console.log(event);
			self.remoteStream = event.stream;
			self.remoteVideo.src = URL.createObjectURL(event.stream);
		}
        
        //Only tells middleware that it wants to start broadcasting now, middleware will ask for offer
		function startBroadcast(stream, speech_info) {
            localStream = stream;
            sendMessageToMiddleware("start_broadcast", typeof speech_info == "undefined" ? {"virtual_id": virtual_id} : {"speech_info": speech_info, "virtual_id": virtual_id});
            
            //Also add its stream to all hotspot connections now
            for (hotspot_id in self.peers_hotspots) {
                if (localStream != null)
                    self.peers_hotspots[hotspot_id].addStream(localStream);
            }
        }
        
        function stopBroadcast() {
            sendMessageToMiddleware("stop_broadcast", {"virtual_id": virtual_id});
                        
            //For all hotspots
            for (hotspot_id in self.peers_hotspots) {
                if (localStream != null)
                    self.peers_hotspots[hotspot_id].removeStream(localStream);
            }
        }        
            
        //Called when middleware sends a request_offer message.
        function createOffer(receiver_id, receiver) {
            var options = null;
            if(receiver == "virtual") {
                options = {
                    "virtual_id": receiver_id,
                    "stream": localStream,
                    //Got local ice candidates
                    "onicecandidate": function (event) {
                        sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'virtual_id': virtual_id, 'receiver_id': receiver_id});
                        
                    },
                    "gotLocalDescription": function (description) {      
                        sendMessageToMiddleware("offer", {'sdp': description, 'virtual_id': virtual_id, 'receiver_id': receiver_id});
                    },
                    "sdpConstraints": sdpConstraints
                };            
            } else if (receiver == "hotspot") {
                options = {
                    "hotspot_id": receiver_id,
                    "stream": localStream,
                    //Got local ice candidates
                    "onicecandidate": function (event) {
                        sendMessageToMiddleware('ice-candidate', {'ice': event.candidate, 'hotspot_id': receiver_id});                    
                    },
                    "gotLocalDescription": function (description) {      
                        sendMessageToMiddleware("offer", {'sdp': description, 'hotspot_id': receiver_id});
                    },
                    "sdpConstraints": sdpConstraintsTest,
                    "onaddstream": self.onaddhotspotstream
                };   
            }
            peers[receiver_id] = Offer.createOffer(options);			
		}
        
        // consider timezone effect: offset in milliseconds
        // http://stackoverflow.com/questions/10830357/javascript-toisostring-ignores-timezone-offset
        function sendMessageToMiddleware(type, payload) {     
            var message_object = {
                'sender': self.itself,
                'receiver': "middleware",
                'timestamp': (new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000)).toISOString(),
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
        
		
    };
    
})();










