'use strict'

var remoteStream;
var remotePeerConnection;

var remoteVideo = document.getElementById('remoteVideo');

remoteVideo.addEventListener('loadedmetadata', function() {
	trace('Remote video currentSrc: ' + this.currentSrc + 
		', videoWidth: ' + this.videoWidth + 
		'px, videoHeight: ' + this.videoHeight + 'px');
});

var watchButton = document.getElementById('watchButton');
watchButton.onclick = watch;

function watch() {
	
}