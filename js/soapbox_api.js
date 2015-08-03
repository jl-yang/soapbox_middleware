'use strict'

(function() {
    window.Soapbox = function(speech_info) {
        var signaling_handler, self = this;
        this.speech_info = speech_info;
    }
})();

var soapbox_global_variables = {
	sdpConstraints: {
		optional: [],
		mandatory: {
			OfferToReceiveAudio: false,
			OfferToReceiveVideo: false
		}
	},
	ws: null,
	soapbox: null,
	send_queue: null,
	receive_queue: null,
	localStream: null,
	PeerConnection: null
};


//Try to tell signaling server that it is about to close
window.onbeforeunload = function(event) {
	send_message("relay-server", "stop_speech_transmission", null);
};

var configuration = {
	iceServers: [
	{
		url: "stun:stun.l.google.com:19302"
	},
	{
		url: "stun:stun.servers.mozilla.com"
	}]
};


var sendWebStompMessage = function(msgObj) {
	//Should use JSON format here, and use JSON.stringify(msgObj) in send method
	soapbox_global_variables.soapbox.send(soapbox_global_variables.send_queue, {}, JSON.stringify(msgObj));
};

//Remember to put function objects first

/********
	Connect to signaling server
********/
function connect_to_signaling_server(server_url, send_queue, receive_queue, user_name, password, vhost, 
									onConnectSignalingServerSuccess, 
									onConnectSignalingServerError,
									onReceiveMessage,
									enableDebug)
{	
	soapbox_global_variables.ws = new SockJS(server_url || 'localhost:15674/stomp');
	soapbox_global_variables.soapbox = Stomp.over(soapbox_global_variables.ws);
	soapbox_global_variables.soapbox.heartbeat.outgoing = 0;
	soapbox_global_variables.soapbox.heartbeat.incoming = 0;
	if (enableDebug !== true)		
	{
		soapbox_global_variables.soapbox.debug = null;
	}
	window.soapbox_global_variables.send_queue = send_queue || "/exchange/logs";
	window.soapbox_global_variables.receive_queue = receive_queue || "/exchange/logs";
	
	soapbox_global_variables.soapbox.connect(
		user_name || 'guest', 
		password || 'guest', 
		//OnConnected
		function(x) {
			var id = soapbox_global_variables.soapbox.subscribe(
				soapbox_global_variables.receive_queue, 
				//Handle incoming messages from signalling server
				function(message) {
					var signal = JSON.parse(message.body);
					
					if(signal.receiver !== 'soapbox')
					{	
						return signal;
					}		
					
					//Assume soapbox will fire the offer
					if (signal.type == "answer" && signal.data.sdp) {				
						soapbox_global_variables.PeerConnection.setRemoteDescription(new RTCSessionDescription(signal.data.sdp));
					} 
					else if(signal.type == "ice-candidate" && signal.data.ice) {
						soapbox_global_variables.PeerConnection.addIceCandidate(new RTCIceCandidate(signal.data.ice));
					} 
					else if(signal.type == "stop_speech_transmission") {
						soapbox_global_variables.PeerConnection.close();
						soapbox_global_variables.PeerConnection = null;
						console.log("Speech transmission stopped");
					}
					return onReceiveMessage(message);
				}
			);
			console.log("Connected to signaling server");
			return onConnectSignalingServerSuccess(x);
		}, 
		//OnError
		function(error) {
			console.log('Failed to connect to signaling server: ' + error.toString());
			return onConnectSignalingServerError(error);
		}, 
		vhost || '/'
	);
	return soapbox_global_variables.soapbox;
}

/********
	Add the local stream when it is ready.
	Then start streaming, but the broadcast is controlled by signaling server.
	Soapbox call this function to start speech, and start logging since then
********/
function start_speech(stream) {	
	//Check if speech has started
	var status = check_speech_transmission_status();
	if (status) {
		console.log("Speech has already started");		
		return;
	}
	
	//Create soapbox_global_variables.PeerConnection, set onicecandidate
	soapbox_global_variables.PeerConnection = new RTCPeerConnection(configuration);
	console.log('Created local peer connection object PeerConnection');	
	soapbox_global_variables.PeerConnection.onicecandidate = gotLocalIceCandidate;
	
	//Add local stream
	soapbox_global_variables.localStream = stream;
	soapbox_global_variables.PeerConnection.addStream(stream);
	console.log('Added localStream to PeerConnection');
	
	//Create offer 
	soapbox_global_variables.PeerConnection.createOffer(
		gotLocalDescription, 
		function onCreateOfferError(error) {
			console.log('Failed to create offer: ' + error.toString());
		}, 
		soapbox_global_variables.sdpConstraints
	);
	
	return soapbox_global_variables.PeerConnection;
}

/********
	If there is some problem, then try another time to start speech transmission
********/
function reset_speech(stream) {
	if(soapbox_global_variables.PeerConnection && soapbox_global_variables.PeerConnection.signalingState != "closed") {
		soapbox_global_variables.PeerConnection.close();
		soapbox_global_variables.PeerConnection = null;
		
		console.log("Try again the speech transmission");
		
		start_speech(stream);
	}
	else
		console.log("Reset speech failure");
}

/********
	
********/
function stop_speech() {
	if(soapbox_global_variables.PeerConnection && soapbox_global_variables.PeerConnection.signalingState != "closed") {
		soapbox_global_variables.PeerConnection.close();
		soapbox_global_variables.PeerConnection = null;
	
		send_message("relay-server", "stop_speech_transmission", null);
	}
	else
		console.log("Stop speech failure");
}

/********
	
********/
function check_speech_transmission_status() {
	if(!soapbox_global_variables.PeerConnection || soapbox_global_variables.PeerConnection.iceConnectionState == "new"
		|| soapbox_global_variables.PeerConnection.iceConnectionState == "checking")
		return false;
	else if(soapbox_global_variables.PeerConnection.iceConnectionState == "closed") {
		soapbox_global_variables.PeerConnection = null;
		return false;
	}		
	else
		return true;
}

/********
	
********/
function send_message(receiver, type, payload)
{
	sendWebStompMessage(
		{
			'sender': 'soapbox',
			'receiver': receiver,
			'timestamp': new Date().toISOString(),
			'type': type,
			'data': payload
		}
	);
}

//Description means SDP
function gotLocalDescription(description) {
    soapbox_global_variables.PeerConnection.setLocalDescription(
		description,
		function () {			
			send_message("relay-server", "offer", {'sdp': description});
			console.log('Offer sdp generated: \n');
			//console.log(description.sdp);
		},
		function () {
			console.log("Set local description error");
		}
	);    
}

function gotLocalIceCandidate(event) {
    if (event.candidate) {
		send_message("relay-server", 'ice-candidate', {'ice': event.candidate});
        console.log('Local ICE candidate gathered');
		//event.candidate.candidate;
    }
}









