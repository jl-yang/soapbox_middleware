# soapbox_middleware

# Soapbox

##How to synchronize the speech 
Remember to include scripts in \<head\> tag
```html
<script src="sockjs.js"></script>
<script src="stomp.js"></script>		
<script src="adapter.js"></script>
<script src="middleware_api.js"></script>
```
Example:
```javascript
//Speech info object, which will be sent to middleware once the connection is on
var speech_info = {"name": "Jilin"};
//API object
var soapbox = new Soapbox();
//Connect to the middleware(signaling server)
//Four params: onConnect, onError, onReceiveMessage, ConfigParams
soapbox.connect(function () {
	//Submit the speech info
	soapbox.submit(speech_info);
	
	//Start speech transmission
	soapbox.start(local_stream);
}, null, null, {"server_url": "10.20.215.140:15674/stomp"});
```

# Hotspot

##How to receive the speech
Example
```javascript
//API object
var hotspot = new Hotspot();
//Setup the video object for displaying remote stream
hotspot.setup(remoteVideo);
//Connect to the middleware(signaling server)
//Four params: onConnect, onError, onReceiveMessage, ConfigParams
hotspot.connect(function () {
	watchButton.addEventListener("click", function() {
		//Start waiting for speech transmission
		var ret = hotspot.wait();
		
		if (ret === true) {
			watchButton.disabled = true;
			stopButton.disabled = false;
		}					
	});	
	stopButton.addEventListener("click", function() {
		//Stop receiving speech, this will also notice soapbox and middleware
		var ret = hotspot.stop();
		
		if (ret === true) {
			stopButton.disabled = true;
			watchButton.disabled = false;
		}					
	});
}, null, null, {"server_url": "10.20.215.140:15674/stomp"});
```




##List of STUN server (https://gist.github.com/zziuni/3741933)
stun.l.google.com:19302
stun1.l.google.com:19302
stun2.l.google.com:19302
stun3.l.google.com:19302
stun4.l.google.com:19302
stun01.sipphone.com
stun.ekiga.net
stun.fwdnet.net
stun.ideasip.com
stun.iptel.org
stun.rixtelecom.se
stun.schlund.de
stunserver.org
stun.softjoys.com
stun.voiparound.com
stun.voipbuster.com
stun.voipstunt.com
stun.voxgratia.org
stun.xten.com

##STUN server tester online
https://plugin.temasys.com.sg/demo/samples/web/content/peerconnection/trickle-ice/index.html

##VM server IP
85.23.168.158


##How to start rabbitmq server in restricted admin access Windows PC
1. Open CMD in Admin mode
2. Temporarily set homedrive and homepath env variables by typing: 
    set homedrive=C:
	set homepath=\Windows
   So that the path of .erlang.cookie file will be located in correct %homedrive%/%homepath% (Usually it is in C:\Windows)
3. Start rabbitmq server in the background by typing:
	rabbitmq-server -detached

##How to install and start rabbitmq server in vm server
###Official Guide: https://www.rabbitmq.com/install-rpm.html
1. Install erlang
2. download rabbitmq rpm
3. import signing key
4. install package
5. Run: chkconfig rabbitmq-server on
        /sbin/service rabbitmq-server stop/start/etc
		
Note: Use this command to fire the server in background.
	sudo rabbitmq-server start -detached 
		
6. Check status of the server: sudo rabbitmqctl status
   And by now, it should be successfully installed and started

##How to start web stomp plugin
1. sudo chmod 777 /etc/rabbitmq/enabled_plugins 
2. sudo rabbitmq-server start -detached

##How to enable others to access than localhost ("guest" user can only connect via localhost)
https://www.rabbitmq.com/access-control.html
1. Default location of config file in RPM should be placed in: /etc/rabbitmq/
2. rabbitmq.config.example file can be retrieved from /usr/share/doc/rabbitmq-server/ or /usr/share/doc/rabbitmq-server-3.5.4/
3. Uncomment a line so that: [{rabbit, [{loopback_users, []}]}]
4. Don't forget to delete the comma after that line

##Troubleshooting
Problem: How to restart rabbitmq server
sudo service rabbitmq-server restart

Problem: Cookie file /var/lib/rabbitmq/.erlang.cookie must be accessible by owner only
http://serverfault.com/questions/406712/rabbitmq-erlang-cookie
chmod 600

Problem: {cannot_read_enabled_plugins_file,"/etc/rabbitmq/enabled_plugins"
http://grokbase.com/t/rabbitmq/rabbitmq-discuss/12ajc9days/rabbitmq-doesnt-start-after-installation-of-rabbitmq-management
https://groups.google.com/forum/#!topic/rabbitmq-users/DtwvJ2W634Q
Change access of the enabled_plugins file to 777
Noted: This file seems to be umasked by root user everytime you want to enable new plugins. Just chmod each time, and restart the server

Problem: Cannot connect to the test hotspot
You must be within the panOulu network (not ee network, or others)

Problem: Video transmission starts and freezes at the first frame using WebRTC.
Add "autoplay" attribute to the video tag for displaying the video 


#To do
1. Enabel SSL and https, for both xampp and rabbitmq ssl options. Thus camera permission can be granted to the website permanently.
2. Add comments
3. Save video and audio locally in soapbox and background upload it to the middleware server
4. Simple browsing website for archiving the history speech and also the current speech
5. Move everything to virtual server with public IP and ports.

