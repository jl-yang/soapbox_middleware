# soapbox_middleware

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




# Soapbox

##How to synchronize the speech (Using API connect_to_signaling_server + start_speech(local_stream))
###Example call
```javascript
connect_to_signaling_server(null, null, null, null, null, null,
	function() {
		//You cannot start the speech unless the connection with signaling server is okay
		start_speech(localStream);
	},
	function(error) {
		console.log("Error");
	},
	function(message){
		console.log("Received:" + JSON.parse(message.body));
	}
);
```

   