import pika
import json
import requests

# Use localhost
mq_params = pika.ConnectionParameters(
    host         = "localhost",
    virtual_host = "/")

receive_client_exchange = "logs"
receive_client_routing_key = "logs"

#Hotspot configs
HOTSPOT_WEBSITE_URL = 'http://10.20.201.229/hotspots2/ubi.html'
HOTSPOT_FULLSREEN_ON_URL = 'http://vm.ubi-hotspot-15.ubioulu.fi/menu/soapClient.php' \
 + '?func=processEvent' \
 + '&param=%3Cevent%20type=%22changeState%22%20name=%22fullscreenon%22%20session=%22ubi-hotspot-15%22%3E%3Coperation%20name=%22setContent%22%3E%3Cparameter%20name=%22id%22%3Efullscreenapp%3C/parameter%3E%3Cparameter%20name=%22resource%22%3E' \
 + HOTSPOT_WEBSITE_URL \
 + '%3C/parameter%3E%3C/operation%3E%3C/event%3E'
HOTSPOT_FULLSCREEN_OFF_URL = 'http://vm.ubi-hotspot-15.ubioulu.fi/menu/soapClient.php' \
 + '?func=processEvent' \
 + '&param=%3Cevent%20type=%22changeState%22%20name=%22fullscreenoff%22%20session=%22ubi-hotspot-15%22%3E%3C/event>'

IS_START = False
IS_ANSWERED = False
 
def handleIncomingMessage(ch, method, properties, body):
	msgObj = json.loads(body)
	print " [x] Message received.      Type:", \
		"{0: <30}".format(msgObj.get("type")), \
		"{0: <15}".format(msgObj.get("sender")), \
		">>", \
		"{0: >15}".format(msgObj.get("receiver"))
	
	type = msgObj.get("type")
	if type == "meta-data":
		r = requests.get(HOTSPOT_FULLSREEN_ON_URL)
		print "Broadcasting speech full screen in hotspot now.", r.text
	if type == "stop_speech_transmission":
		r = requests.get(HOTSPOT_FULLSCREEN_OFF_URL)
		print "Stop broadcast speech.", r.text
	
	#ch.basic_publish(exchange=send_client_exchange, routing_key=send_client_routing_key, body=json.dumps(msgObj))
	
if __name__ == "__main__":
	
	connection = pika.BlockingConnection(mq_params)
	channel = connection.channel()
	
	channel.exchange_declare(exchange=receive_client_exchange, type='fanout')
	#channel.exchange_declare(exchange=send_client_exchange, type='fanout')
	
	result = channel.queue_declare(exclusive=True, auto_delete=True)
	queue_name = result.method.queue
	
	channel.queue_bind(exchange=receive_client_exchange, queue=queue_name)
	
	print ' [*] Waiting for messages. To exit press CTRL+C'
	
	channel.basic_consume(handleIncomingMessage, queue=queue_name, no_ack=True)
	
	channel.start_consuming()