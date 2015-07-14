'use strict'

//Start real stuff from here
var remoteStream;
var PeerConnection;
var remoteVideo = document.getElementById('remoteVideo');

var watchButton = document.getElementById('watchButton');
watchButton.onclick = watch;
var stopButton = document.getElementById('stopButton');
stopButton.onclick = stop;
watchButton.disabled = false;
stopButton.disabled = true;

var ws = new SockJS('localhost:15674/stomp');
var client = Stomp.over(ws);
client.heartbeat.outgoing = 0;
client.heartbeat.incoming = 0;
var send_queue = "/exchange/logs";
var receive_queue = "/exchange/logs";

var sdpConstraints = {
	optional: [],
	mandatory: {
		OfferToReceiveAudio: true,
		OfferToReceiveVideo: true
	}
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

remoteVideo.addEventListener('loadedmetadata', function() {
	trace('Remote video currentSrc: ' + this.currentSrc + 
		', videoWidth: ' + this.videoWidth + 
		'px, videoHeight: ' + this.videoHeight + 'px');
});

var onWebStompError =  function() {
	console.log('Stomp connection error');
};

var sendWebStompMessage = function(msgObj) {
	//Should use JSON format here, and use JSON.stringify(msgObj) in send method
	client.send(send_queue, {}, JSON.stringify(msgObj));
};

//Handle incoming messages from signaling server
var onReceiveMessages = function(message) {
	var signal = JSON.parse(message.body);
	if(signal.sender !== 'soapbox')
		return;
	if (signal.sdp) {
		PeerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
	} else if(signal.ice) {
		PeerConnection.addIceCandidate(new RTCIceCandidate(signal.ice));
	}
};

var onWebStompConnect = function() {
	var id = client.subscribe(receive_queue, onReceiveMessages);
};

client.connect('guest', 'guest', onWebStompConnect, onWebStompError, '/');

function watch() {
	watchButton.disabled = true;
	stopButton.disabled = false;
	if(!PeerConnection) {
		PeerConnection = new RTCPeerConnection(configuration);
		PeerConnection.onicecandidate = gotIceCandidate;
		PeerConnection.onaddstream = gotRemoteStream;
	}
	
	PeerConnection.createOffer(gotDescription, onCreateOfferError, sdpConstraints);
}

function stop() {
	watchButton.disabled = false;
	stopButton.disabled = true;
	trace('Stop watching');
	PeerConnection.close();
	PeerConnection = null;
}

function gotRemoteStream(event) {
    remoteVideo.src = URL.createObjectURL(event.stream);
    trace('Received remote stream');
}

//Description means SDP
function gotDescription(description) {
    PeerConnection.setLocalDescription(description,	function () {
		sendWebStompMessage(
			{
				'sender': 'client',
				'sdp': description
			}
		);
		trace('Offer sdp from PeerConnection: \n');
	}, function () { trace("Set local description error");});  
}

function gotIceCandidate(event) {
	if(!event.candidate) {
        sendWebStompMessage(
			{
				'sender': 'client',
				'ice': event.candidate
			}
		);
    }
}

function onCreateOfferError(error) {
	trace('Failed to create offer: ' + error.toString());
}


