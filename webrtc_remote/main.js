'use strict'

//Start real stuff from here
var remoteStream;
var PeerConnection;
var remoteVideo = document.getElementById('remoteVideo');

var watchButton = document.getElementById('watchButton');
watchButton.onclick = wait_for_speech;
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

var debug_function = client.debug;
//client.debug = null;

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
	console.log('Remote video currentSrc: ' + this.currentSrc + 
		', videoWidth: ' + this.videoWidth + 
		'px, videoHeight: ' + this.videoHeight + 'px');
});

var onWebStompError =  function() {
	console.log('Failed to connect to signaling server');
};

var sendWebStompMessage = function(msgObj) {
	//Should use JSON format here, and use JSON.stringify(msgObj) in send method
	client.send(send_queue, {}, JSON.stringify(msgObj));
};

//Handle incoming messages from signaling server
var onReceiveMessages = function(message) {
	var signal = JSON.parse(message.body);
	
	if(signal.receiver !== 'relay-server')
	{	
		return;
	}
	
	if (signal.type == "offer" && signal.data.sdp) {				
		if(!PeerConnection) {
			PeerConnection = new RTCPeerConnection(configuration);
		    console.log('Created local peer connection object PeerConnection');
			PeerConnection.onicecandidate = gotLocalIceCandidate;
			PeerConnection.onaddstream = gotRemoteStream;
		}
		
		PeerConnection.setRemoteDescription(new RTCSessionDescription(signal.data.sdp), function () {
			PeerConnection.createAnswer(gotLocalDescription, onCreateAnswerError);
		});
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

var onWebStompConnect = function() {
	var id = client.subscribe(receive_queue, onReceiveMessages);
	console.log("Connected to signaling server");
};

client.connect('guest', 'guest', onWebStompConnect, onWebStompError, '/');

wait_for_speech();

function wait_for_speech() {
	watchButton.disabled = true;
	stopButton.disabled = false;
	if(!PeerConnection) {
		PeerConnection = new RTCPeerConnection(configuration);
		PeerConnection.onicecandidate = gotLocalIceCandidate;
		PeerConnection.onaddstream = gotRemoteStream;
	}	
}

function stop() {
	watchButton.disabled = false;
	stopButton.disabled = true;
	
	if(PeerConnection && PeerConnection.signalingState != "closed") {
		PeerConnection.close();
		PeerConnection = null;	
		
		console.log('Stop watching/waiting for speech');
		
		send_message("soapbox",	"stop_speech_transmission", null);
	}
	else
		console.log("Stop speech failure");
}

//Compatible usage
function send_message(receiver, type, payload)
{
	sendWebStompMessage(
		{
			'sender': 'relay-server', //by default
			'receiver': receiver,
			'timestamp': new Date().toISOString(),
			'type': type,
			'data': payload
		}
	);
}

function gotRemoteStream(event) {
    remoteVideo.src = URL.createObjectURL(event.stream);
    console.log('Received remote stream');
}

//Description means SDP
function gotLocalDescription(description) {
    PeerConnection.setLocalDescription(
		description,	
		function () {
			send_message('soapbox',	'answer', {'sdp': description});
			console.log('Answer sdp generated');
		}, 
		function () { 
			console.log("Set local description error");
		}
	);  
}

function gotLocalIceCandidate(event) {
    if (event.candidate) {
		send_message("soapbox", 'ice-candidate', {'ice': event.candidate});
        console.log('Local ICE candidate gathered');
    }
}


function onCreateAnswerError(error) {
	console.log('Failed to create answer: ' + error.toString());
}
