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


##How to start rabbitmq server in restricted admin access PC
1. Open CMD in Admin mode
2. Temporarily set homedrive and homepath env variables by typing: 
    set homedrive=C:
	set homepath=\Windows
   So that the path of .erlang.cookie file will be located in correct %homedrive%/%homepath% (Usually it is in C:\Windows)
3. Start rabbitmq server in the background by typing:
	rabbitmq-server -detached
	