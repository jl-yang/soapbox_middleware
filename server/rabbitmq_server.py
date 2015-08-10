import pika
import json
import requests

# Local rabbitmq server
mq_params = pika.ConnectionParameters(
    host         = "localhost",
    virtual_host = "/")
queue_name = "test"
channel = None

# Test hotspot rabbitmq server
rabbitmq_params = pika.ConnectionParameters(
	host = "bunny.ubioulu.fi",
	)
rabbitmq_credentials = pika.PlainCredentials('middleware', '5492pn0GE884E5Ma6nO44KO0N7875W4v')
rabbitmq_exchange = "lmevent"
rabbitmq_routing_key = "fi.ubioulu.lmevent"
json_fullscreen_on = {
	"event": {
		"id": "123",
		"operation":[{
			"parameter":[
				{
					"name":"fullscreenapp",
					"type":"id"
				},
				{
					"name":"http:\/\/www.ubioulu.fi",
					"type":"resource"
				}
			],
			"type": "setContent"
		}],
		"session":"ubi-hotspot-15",
		"name":"fullscreenon",
		"type":"changeState",
		"endpoint":""
	}
}
json_fullscreen_off = {
	"event": {
		"id":"123",
		"session":"ubi-hotspot-15",
		"name":"fullscreenoff",
		"type":"changeState",
		"endpoint":""
	}
}


receive_client_exchange = "logs"
receive_client_routing_key = "logs"
send_client_exchange = "logs"
send_client_routing_key = "logs"


#Hotspot configs
HOTSPOT_WEBSITE_URL = 'http://10.20.204.146/hotspots3/ubi.html'
HOTSPOT_WEBSITE_OULU = 'http://www.ubioulu.fi'
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

LIKES = 0
DISLIKES = 0
REPORT = 0

def handleIncomingMessage(ch, method, properties, body):
	msgObj = json.loads(body)
	print " [x] Message received.      Type:", \
		"{0: <30}".format(msgObj.get("type")), \
		"{0: <15}".format(msgObj.get("sender")), \
		">>", \
		"{0: >15}".format(msgObj.get("receiver"))
	
	if msgObj.get("receiver") == "all":
		return
	
	type = msgObj.get("type")
	if type == "meta-data":
		r = requests.get(HOTSPOT_FULLSREEN_ON_URL)
		print "Broadcasting speech full screen in hotspot now.", r.text
	if type == "stop_speech_transmission":
		r = requests.get(HOTSPOT_FULLSCREEN_OFF_URL)
		print "Stop broadcast speech.", r.text
	if type == "like":	
		global LIKES
		LIKES += 1
		print "Likes: ", LIKES
		update_likes = {"sender": "middleware", "receiver": "all", "timestamp": None, "type": "like", "data": {"likes": LIKES}}
		ch.basic_publish(exchange=send_client_exchange, routing_key=send_client_routing_key, body=json.dumps(update_likes))
		print update_likes

def on_connected(connection):
	"""Called when we are fully connected to RabbitMQ"""
	#Open a channel
	connection.channel(on_channel_open)
	
def on_channel_open(new_channel):
	"""Called when our channel has opened"""
	global channel
	channel = new_channel	
	channel.exchange_declare(exchange=receive_client_exchange, type='fanout')
	channel.queue_declare(queue=queue_name, durable=True, exclusive=True, auto_delete=False, callback=on_queue_declared)
	channel.queue_bind(exchange=receive_client_exchange, queue=queue_name)
	
def on_queue_declared(frame):
	"""Called when Queue has been declared, frame is the response from RabbitMQ"""
	channel.basic_consume(handle_delivery, queue="test")

def handle_delivery(channel, method, header, body):
	"""Called when there is a message"""
	msgObj = json.loads(body)
	print " [x] Message received.      Type:", \
		"{0: <30}".format(msgObj.get("type")), \
		"{0: <15}".format(msgObj.get("sender")), \
		">>", \
		"{0: >15}".format(msgObj.get("receiver"))
	
	if msgObj.get("receiver") == "all":
		return
	
	type = msgObj.get("type")
	if type == "meta-data":
		r = requests.get(HOTSPOT_FULLSREEN_ON_URL)
		print "Broadcasting speech full screen in hotspot now.", r.text
	if type == "stop_speech_transmission":
		r = requests.get(HOTSPOT_FULLSCREEN_OFF_URL)
		print "Stop broadcast speech.", r.text
	if type == "like":	
		global LIKES
		LIKES += 1
		print "Likes: ", LIKES
		update_likes = {"sender": "middleware", "receiver": "all", "timestamp": None, "type": "like", "data": {"likes": LIKES}}
		ch.basic_publish(exchange=send_client_exchange, routing_key=send_client_routing_key, body=json.dumps(update_likes))
		print update_likes
		
if __name__ == "__main__":
	
	#Reset test hotspot to default
	r = requests.get(HOTSPOT_FULLSCREEN_OFF_URL)	
	
	connection = pika.SelectConnection(mq_params)	
	try:			
		print ' [*] Waiting for messages. To exit press CTRL+C'
		connection.ioloop.start()
		
	except KeyboardInterrupt:
		connection.close()
		connection.ioloop.start()
		
		
	#channel.queue_bind(exchange=receive_client_exchange, queue=queue_name)
	
	#result_test_hotspot = channel.queue_declare(exclusive=True, auto_delete=True)
	#queue_name_test_hotspot = result_test_hotspot.method.queue
	
	#channel.queue_bind(exchange="lmevent")
	
	
	#channel.basic_consume(handleIncomingMessage, queue=queue_name, no_ack=True)
	