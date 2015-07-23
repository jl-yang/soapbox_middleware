'use strict'

var sdpConstraints = {
	optional: [],
	mandatory: {
		OfferToReceiveAudio: false,
		OfferToReceiveVideo: false
	}
};

var ws = new SockJS('85.23.168.158:15674/stomp');
var soapbox = Stomp.over(ws);
soapbox.heartbeat.outgoing = 0;
soapbox.heartbeat.incoming = 0;
var send_queue = "/exchange/logs";
var receive_queue = "/exchange/logs";

var debug_function = soapbox.debug;
//soapbox.debug = null;

var localStream;

var PeerConnection;

/***Should be discarded out of API***/
var localVideo = document.getElementById('localVideo');

localVideo.addEventListener('loadedmetadata', function() {
    console.log('Local video currentSrc: ' + this.currentSrc + 
        ', videoWidth: ' + this.videoWidth + 
        'px, videoHeight: ' + this.videoHeight + 'px');
});
/************************************/

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

//Handle incoming messages from signalling server
var onReceiveMessages = function(message) {
	var signal = JSON.parse(message.body);
	
	if(signal.receiver !== 'soapbox')
	{	
		return;
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
};

var onWebStompConnect = function(x) {
	var id = soapbox.subscribe(receive_queue, onReceiveMessages);
	console.log("Connected to signaling server");
};

var onWebStompError =  function(error) {
	console.log('Failed to connect to signaling server: ' + error.toString());
};

var sendWebStompMessage = function(msgObj) {
	//Should use JSON format here, and use JSON.stringify(msgObj) in send method
	soapbox.send(send_queue, {}, JSON.stringify(msgObj));
};

/********
	Connect to signaling server
********/
//Remember to put function objects first
soapbox.connect('guest', 'guest', onWebStompConnect, onWebStompError, '/');

/********
	
********/

/********
	Get local video stream from camera.
	It will be handled by Soapbox website
********/


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
	
	//Create PeerConnection, set onicecandidate
	PeerConnection = new RTCPeerConnection(configuration);
    console.log('Created local peer connection object PeerConnection');	
	PeerConnection.onicecandidate = gotLocalIceCandidate;
	
	//Add local stream
	localStream = stream;
	PeerConnection.addStream(stream);
	console.log('Added localStream to PeerConnection');
	
	//Create offer 
	PeerConnection.createOffer(gotLocalDescription, onCreateOfferError, sdpConstraints);
}

/********
	If there is some problem, then try another time to start speech transmission
********/
function reset_speech(stream) {
	if(PeerConnection && PeerConnection.signalingState != "closed") {
		PeerConnection.close();
		PeerConnection = null;
		
		console.log("Try again the speech transmission");
		
		start_speech(stream);
	}
	else
		console.log("Reset speech failure");
}

/********
	
********/
function stop_speech() {
	if(PeerConnection && PeerConnection.signalingState != "closed") {
		PeerConnection.close();
		PeerConnection = null;
	
		send_message("relay-server", "stop_speech_transmission", null);
	}
	else
		console.log("Stop speech failure");
}

/********
	
********/
function check_speech_transmission_status() {
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

/********
	
********/
function set_receive_message_handler()
{
	
}

start();

function start() {
    console.log('Requesting local stream');
    navigator.getUserMedia(
        {
            video: true,
            audio: true
        }, 
        gotStream, 
		onGetUserMediaError
	);
}

function gotStream(stream) {   
    console.log('Received local stream');
	localStream = stream;
    localVideo.src = URL.createObjectURL(stream);   

	if(localStream.getVideoTracks().length > 0) {
        console.log('Using video device: ' + localStream.getVideoTracks()[0].label);
    }
    if(localStream.getAudioTracks().length > 0) {
        console.log('Using audio device: ' + localStream.getAudioTracks()[0].label);
    }
	
	start_speech(localStream);	
}

//Description means SDP
function gotLocalDescription(description) {
    PeerConnection.setLocalDescription(
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



function onGetUserMediaError(error) {
	console.log('navigator.getUserMedia error: ', error);
}

function onCreateOfferError(error) {
	console.log('Failed to create offer: ' + error.toString());
}







