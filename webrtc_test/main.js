'use strict'

//Use secure WebSocket (TLS)
var socket = new WebSocket("wss://localhost:9999/");
socket.onopen = function (event) {
	console.log("CONNECTED WebSocket");
};
socket.onmessage = function (event) {
	console.log("RECEIVED DATA:" + event.data);
}
//Use socket.send("Msg")   socket.close()

var sdpConstraints = {
	optional: [],
	mandatory: {
		OfferToReceiveAudio: true,
		OfferToReceiveVideo: true
	}
};


var localStream;
var localPeerConnection;
var remotePeerConnection;

var localVideo = document.getElementById('localVideo');
var remoteVideo = document.getElementById('remoteVideo');

localVideo.addEventListener('loadedmetadata', function() {
    trace('Local video currentSrc: ' + this.currentSrc + 
        ', videoWidth: ' + this.videoWidth + 
        'px, videoHeight: ' + this.videoHeight + 'px');
});

remoteVideo.addEventListener('loadedmetadata', function() {
    trace('Local video currentSrc: ' + this.currentSrc + 
        ', videoWidth: ' + this.videoWidth + 
        'px, videoHeight: ' + this.videoHeight + 'px');
});

var startButton = document.getElementById('startButton');
var callButton = document.getElementById('callButton');
var hangupButton = document.getElementById('hangupButton');
startButton.disabled = false;
callButton.disabled = true;
hangupButton.disabled = true;
startButton.onclick = start;
callButton.onclick = call;
hangupButton.onclick = hangup;

function gotStream(stream) {   
    trace('Received local stream');
    localVideo.src = URL.createObjectURL(stream);
    localStream = stream;
    callButton.disabled = false;
}

function start() {
    trace('Requesting local stream');
    startButton.disabled = true;
    navigator.getUserMedia(
        {
            video: true,
            audio: true
        }, 
        gotStream, 
        function(error) {
        trace('navigator.getUserMedia error: ', error);
    });
}

function call() {
    callButton.disabled = true;
    hangupButton.disabled = false;
    trace('Starting call');    
	
	if(localStream.getVideoTracks().length > 0) {
        trace('Using video device: ' + localStream.getVideoTracks()[0].label);
    }
    if(localStream.getAudioTracks().length > 0) {
        trace('Using audio device: ' + localStream.getAudioTracks()[0].label);
    }
	
	var configuration = {
		iceServers: [
		{
			url: "stun:stun.l.google.com:19302"
		},
		{
			url: "stun:stun.servers.mozilla.com"
		}]
	}
	
    localPeerConnection = new RTCPeerConnection(configuration);
    trace('Created local peer connection object localPeerConnection');
    localPeerConnection.onicecandidate = gotLocalIceCandidate;
	
	remotePeerConnection = new RTCPeerConnection();
    trace('Created remote peer connection object remotePeerConnection');
    remotePeerConnection.onicecandidate = gotRemoteIceCandidate;
    remotePeerConnection.onaddstream = gotRemoteStream;
	
	localPeerConnection.addStream(localStream);
    trace('Added localStream to localPeerConnection');
	//optional: [DtlsSrtpKeyAgreement] DTLS/SRTP is preferred on chrome
    localPeerConnection.createOffer(
		gotLocalDescription, 
		onCreateSessionDescriptionError, 
		sdpConstraints
	);
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

//Description means SDP
function gotLocalDescription(description) {
    localPeerConnection.setLocalDescription(description);
    trace('Offer sdp from localPeerConnection: \n' + description.sdp);
    remotePeerConnection.setRemoteDescription(description);
    remotePeerConnection.createAnswer(gotRemoteDescription);
}

function gotRemoteDescription(description) {
    remotePeerConnection.setLocalDescription(description);
    trace('Answer from remotePeerConnection: \n' + description.sdp);
    localPeerConnection.setRemoteDescription(description);
}

function hangup() {
    trace('Ending call');
    localPeerConnection.close();
    remotePeerConnection.close();
    localPeerConnection = null;
    remotePeerConnection = null;
    hangupButton.disabled = true;
    callButton.disabled = false;
}

function gotRemoteStream(event) {
    remoteVideo.src = URL.createObjectURL(event.stream);
    trace('Received remote stream');
}

function gotLocalIceCandidate(event) {
    if (event.candidate) {
        remotePeerConnection.addIceCandidate(new RTCIceCandidate(event.candidate));
        trace('Local ICE candidate: \n' + event.candidate.candidate);
    }
}

function gotRemoteIceCandidate(event) {
    if (event.candidate) {
        localPeerConnection.addIceCandidate(new RTCIceCandidate(event.candidate));
        trace('Remote ICE candidate: \n' + event.candidate.candidate);
    }
}






