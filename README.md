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

##How to start rabbitmq server in restricted admin access PC
1. Open CMD in Admin mode
2. Temporarily set homedrive and homepath env variables by typing: 
    set homedrive=C:
	set homepath=\Windows
   So that the path of .erlang.cookie file will be located in correct %homedrive%/%homepath% (Usually it is in C:\Windows)
3. Start rabbitmq server in the background by typing:
	rabbitmq-server -detached

##How to restart rabbitmq server
sudo service rabbitmq-server restart
	
##How to install and start rabbitmq server in vm server
###Official Guide: https://www.rabbitmq.com/install-rpm.html
1. Install erlang
2. download rabbitmq rpm
3. import signing key
4. install package
5. Run: chkconfig rabbitmq-server on
        /sbin/service rabbitmq-server stop/start/etc
6. Check status of the server: rabbitmqctl status
   And by now, it should be successfully installed and started

##Enable Web Stomp Plugin in VM server
###RabbitMQ and related tools (e.g. rabbitmq-plugins) need the enabled_plugins file to be 
both readable and writeable

##How to start web stomp plugin
1. First find out the rabbitmq.config file in /usr/share/doc/rabbitmq-server-3.5.4/
2. 
   