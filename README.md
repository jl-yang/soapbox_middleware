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
//lefttime: dd/mm/YY HH:MM (Time you want to start speech)
var lefttime = current_time_string(); //Example: "21/02/2016 12:05"
var speech_info = {"name": "Jilin", "topic": "New speech", "lefttime": lefttime, "password": "abcdefg123"};

//API object
var soapbox = new Soapbox();

//Connect to the middleware(signaling server)
//Four params: onConnect, onError, onReceiveMessage, ConfigParams
soapbox.connect(function () {
    //Mandatory, register itself
    soapbox.register();

	//Submit the speech info
	soapbox.submit(speech_info);
	
    //Start speech transmission
	soapbox.start(local_stream);
    //start a new speech immediately
    //soapbox.start(local_stream, submit_info)
    
    //Callback of validating password
    soapbox.onvalidationresult = function(result) {
        //result will be -1, 0, 1, or 2
        //2 means exact password for next speech
        //1 means valid password but not for next speech
        //0 means invalid password
        //-1 means now no reservation at all 
    }    
    //Request validating a password to check if it is for the next speech
    soapbox.validate(password);
    
    //Callback of deleting a speech
    soapbox.ondeletespeech = function(success) {
        //success is a boolean value: true or false
    }
    //Delete a speech based on corresponding password
    soapbox.delete_speech(password);
    
});

//Try to tell middleware that it is about to close
window.onbeforeunload = function(event) {
    soapbox.stop();
};
```

### Register callbacks for likes, dislikes, reports, comments

```javascript
//Register likes update callback
soapbox.onreceivelikes = function (likes) {
    //Show the likes info
    console.log("Current likes: " + likes);
};
//Register dislikes update callback
soapbox.onreceivedislikes = function (dislikes) {};
    
//Register comment update callback
soapbox.onreceivecomment = function (username, comment) {};
    
//Register reports update callback
soapbox.onreceivereports = function (reports) {};
```

### Register callbacks for all speeches, upcoming speeches today, next speech, current speech

```javascript
//Callback of all speeches
soapbox.onreceiveallspeeches = function (speeches) {
    //It would be an array like below, noted  that the value of "submit_info" field would preserve as whatever you send when you submit
    //   [ {
    //       "speech_id": "10/09/2014 12:00", "submit_info": {"lefttime": XXX, "topic": XXX ...}
    //     },
    //     {
    //        "speech_id": "10/09/2016 12:00", "submit_info": {"lefttime": XXX, "topic": XXX ...}
    //     },
    //      ...
    //   ]
    console.log(speeches);
}    
//Initial the action to send me all reservations
soapbox.all_speeches();

//Callback of upcoming speeches today, including today's next speech
soapbox.onreceiveupcomingtodayspeech = function(speeches) {
    //Similar as onreceiveallspeeches
}
soapbox.upcoming_speeches_today();

//Callback of requesting next speech info
soapbox.onreceivenextspeechinfo = function(speech_info) {
    console.log(speech_info);
}
//Ask for next speech
soapbox.next_speech();

soapbox.onreceivecurrentspeechinfo = function(current_speech) {
    console.log(current_speech);
}
soapbox.current_speech();
```

### Examples of extracting date and time string from received date_time_string: (Format is "%d/%m/%Y %H:%M")
```javascript
var date_time = extract_date_time("25/11/2015 12:00");
    //Output: {date: "25/11/2015", time: "12:00"}
//You can access date string via date_time.date, or time string via date_time.time

//More customized options, like extracting exact day, month, year, hour, minute string from it
extract_date_time("25/11/2015 12:00", {"day": true, "year": true})
    //Output: {date: "25/11/2015", time: "12:00", day: "25", year: "2015"}
```


# Hotspot

##How to receive the speech
Example:
```javascript
//API object
var hotspot = new Hotspot();

//Setup the video object for displaying remote stream
var remoteVideo = document.getElementById('remoteVideo'); //It should be your video element
hotspot.setup(remoteVideo);

//Connect to the middleware(signaling server)
//Four params: onConnect, onError, onReceiveMessage, ConfigParams
hotspot.connect(function () {
    //To register callbacks of likes, dislikes, reports, comment, usage is the same as soapbox example above

    //Mandatory, register itself
	hotspot.register();
});

//Make sure now you are already connected, otherwise it could fail
hotspot.like()
hotspot.dislike()
hotspot.report()
```

# Audience

##How to comment
Example:
```javascript
//API object
var audience = new Audience();

//Each time you want to comment, you can use connection method first (different from hotspot and soapbox)
audience.connect(function () {
    //Set up speech info callback, speech_info is a JSON object
    audience.onreceivespeechinfo = function (speech_info) {
        console.log(speech_info);
    }    
    
    //Request for initial update of speech info
    audience.get_speech_info();

    //You can comment here 
    audience.comment("user2015", "I want to make a comment now!");
    
    //Online for a speech
    audience.online();
    
    //Offline when close the connection
    audience.offline();
    
    //Callback of current users 
    audience.onreceivecurrentusers = function (users) {
        //users is the amount of current users for current speech
    }
});
```

# Virtual soapbox

##How to receive the speech
Example:
```javascript
//API object
var virtual = new Virtual();

//Setup the video object for displaying remote stream
var remoteVideo = document.getElementById('remoteVideo'); //It should be your video element
virtual.setup(remoteVideo);

//Connect to the middleware(signaling server)
//Four params: onConnect, onError, onReceiveMessage, ConfigParams
virtual.connect(function () {
    //First it needs to register
    virtual.register();
    
    //If it wants to start a speech right now
    virtual.start(local_stream, submit_info); 
    
    //Try to tell middleware that it is about to close
    virtual.stop(); 
});

//Register callbacks
virtual.onreceivespeechinfo = function(speech_info) {};
virtual.onreceivecomment = function(username, comment) {};
virtual.onreceivelikes = function(likes){};
virtual.onreceivedislikes = function(dislikes){};
virtual.onreceivereports = function(reports){};
virtual.onreceivecurrentusers = function(users){};  //TODO - using online and offline in virtual to handle this info

virtual.comment("Jilin", "I want to comment now");
virtual.like();
virtual.dislike();
virtual.report();
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
1. Problem: How to restart rabbitmq server
sudo service rabbitmq-server restart

2. Problem: Cookie file /var/lib/rabbitmq/.erlang.cookie must be accessible by owner only
http://serverfault.com/questions/406712/rabbitmq-erlang-cookie
chmod 600

3. Problem: {cannot_read_enabled_plugins_file,"/etc/rabbitmq/enabled_plugins"
http://grokbase.com/t/rabbitmq/rabbitmq-discuss/12ajc9days/rabbitmq-doesnt-start-after-installation-of-rabbitmq-management
https://groups.google.com/forum/#!topic/rabbitmq-users/DtwvJ2W634Q
Change access of the enabled_plugins file to 777
Noted: This file seems to be umasked by root user everytime you want to enable new plugins. Just chmod each time, and restart the server

4. Problem: Cannot connect to the test hotspot
You must be within the panOulu network (not ee network, or others)

5. Problem: Video transmission starts and freezes at the first frame using WebRTC.
Add "autoplay" attribute to the video tag for displaying the video 

6. Problem: When soapbox is broadcasting to many hotspots and soapbox goes down and reconnects, basically middleware will ask for multiple offers at the same time.
Then soapbox will react to it, and iceConnectionState remain "checking" and adapter.js has typeeeror as cannot setRemoteDescription because STATE_INPROGRESS
*This problem is actually very severe if multiple hotspot clients are requesting simultaneously, or soapbox goes down in the middle of multi-broadcasting.*
I tried delaying the answers from middleware, or disabling the ICE trickling, but neither worked.
The only solution is to send "ready" flag when soapbox has successfully set remote description.
Meanwhile, enable middleware to start new threads for sending requests of offers to soapbox only when status of soapbox is ready.
Remember to use lock in threaded function, as it could cause serious potential problems if the request_offer message is not sent integratedly
http://w3c.github.io/webrtc-pc/#rtciceconnectionstate-enum
https://groups.google.com/forum/#!topic/discuss-webrtc/vINLJSSOxtE

7. Problem: MediaStreamRecorder.js has TypeError: videoElement.start is not a function. Thus we cannot use the stream recording API.
Check whether your html adds RecordRTC.js and MediaStreamRecorder.js at the same time. It seems they are conflicted and should only be added either one.

8. Problem: Cannot use window.saveAs in Chrome
Use this repo to add FileSaver.js in your resources:
https://github.com/eligrey/FileSaver.js

9. Problem: _id default field in MongoDB is retrieved but not JSON serializable
Need to explicitly exclude _id as it is not JSON serializable


#To do
1. Enabel SSL and https, for both xampp and rabbitmq ssl options. Thus camera permission can be granted to the website permanently.
2. Add comments
3. Save video and audio locally in soapbox and background upload it to the middleware server
Solution: Soapbox will save it using manual confirm in prompt. Then it sends a message to /exchange/soapbox/stream_uploader when everything is ready.
Then the local stream_uploader script will send the local stream files to middleware using other methods.
Then middleware will combine the video/webm and audio/wav streams together, and save it to database

4. Simple browsing website for archiving the history speech and also the current speech
5. Move everything to virtual server with public IP and ports.

#Notice
Run MongoDB instance locally for now: mongod
