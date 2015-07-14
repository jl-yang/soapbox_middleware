'use strict'

var ws = new SockJS('localhost:15674/stomp');
var soapbox = Stomp.over(ws);
soapbox.heartbeat.outgoing = 0;
soapbox.heartbeat.incoming = 0;
var send_queue = "/exchange/logs";
var receive_queue = "/exchange/logs";

var localStream;
var PeerConnection;

var localVideo = document.getElementById('localVideo');

localVideo.addEventListener('loadedmetadata', function() {
    trace('Local video currentSrc: ' + this.currentSrc + 
        ', videoWidth: ' + this.videoWidth + 
        'px, videoHeight: ' + this.videoHeight + 'px');
});

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
	if(signal.sender !== 'client')
		return;
	//Assume client will send offer to soapbox
	if (signal.sdp) {		
		PeerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp), function () {
			PeerConnection.createAnswer(gotDescription, onCreateAnswerError);
		});
	} else if(signal.ice) {
		PeerConnection.addIceCandidate(new RTCIceCandidate(signal.ice));
	}
};

var onWebStompConnect = function(x) {
	var id = soapbox.subscribe(receive_queue, onReceiveMessages);
};

var onWebStompError =  function(error) {
	console.log('Stomp connection error: ' + error.toString());
};

var sendWebStompMessage = function(msgObj) {
	//Should use JSON format here, and use JSON.stringify(msgObj) in send method
	soapbox.send(send_queue, {}, JSON.stringify(msgObj));
};

//Remember to put function objects first
soapbox.connect('guest', 'guest', onWebStompConnect, onWebStompError, '/');

start();

function start() {
    trace('Requesting local stream');
    navigator.getUserMedia(
        {
            video: true,
            audio: true
        }, 
        gotStream, 
		onGetUserMediaError
	);
	
	PeerConnection = new RTCPeerConnection(configuration);
    trace('Created local peer connection object PeerConnection');
	
	PeerConnection.onicecandidate = gotLocalIceCandidate;
}

function gotStream(stream) {   
    trace('Received local stream');
	localStream = stream;
    localVideo.src = URL.createObjectURL(stream);   

	if(localStream.getVideoTracks().length > 0) {
        trace('Using video device: ' + localStream.getVideoTracks()[0].label);
    }
    if(localStream.getAudioTracks().length > 0) {
        trace('Using audio device: ' + localStream.getAudioTracks()[0].label);
    }
	//No need to set onaddstream using gotRemoteStream method, as we don't deal with it
	PeerConnection.addStream(localStream);
	trace('Added localStream to PeerConnection');
}

//Description means SDP
function gotDescription(description) {
    PeerConnection.setLocalDescription(
		description,
		function () {			
			trace('Answer sdp from PeerConnection: \n');
			sendWebStompMessage(
				{
					'sender': 'soapbox',
					'sdp': description
				}
			);//trace(description.sdp);
		},
		function () {
			trace("Set local description error");
		}
	);    
}

function gotLocalIceCandidate(event) {
    if (event.candidate) {
		sendWebStompMessage(
			{
				'sender': 'soapbox',
				'ice': event.candidate
			}
		);
        //remotePeerConnection.addIceCandidate(new RTCIceCandidate(event.candidate));
        trace('Local ICE candidate: \n' + event.candidate.candidate);
    }
}

function gotRemoteIceCandidate(event) {
    if (event.candidate) {
        PeerConnection.addIceCandidate(new RTCIceCandidate(event.candidate));
        trace('Remote ICE candidate: \n' + event.candidate.candidate);
    }
}

function onGetUserMediaError(error) {
	trace('navigator.getUserMedia error: ', error);
}

function onCreateOfferError(error) {
	trace('Failed to create offer: ' + error.toString());
}

function onCreateAnswerError(error) {
	trace('Failed to create answer: ' + error.toString());
}





