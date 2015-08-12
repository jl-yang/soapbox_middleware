import pika
import json
import requests





class Middleware(object):
    #Hotspot configs
    HOTSPOT_WEBSITE_URL = 'http://85.23.168.158'
    HOTSPOT_WEBSITE_OULU = 'http://www.ubioulu.fi'
    HOTSPOT_FULLSCREEN_ON_URL = 'http://vm.ubi-hotspot-15.ubioulu.fi/menu/soapClient.php' \
    + '?func=processEvent' \
    + '&param=%3Cevent%20type=%22changeState%22%20name=%22fullscreenon%22%20session=%22ubi-hotspot-15%22%3E%3Coperation%20name=%22setContent%22%3E%3Cparameter%20name=%22id%22%3Efullscreenapp%3C/parameter%3E%3Cparameter%20name=%22resource%22%3E' \
    + HOTSPOT_WEBSITE_URL \
    + '%3C/parameter%3E%3C/operation%3E%3C/event%3E'
    HOTSPOT_FULLSCREEN_OFF_URL = 'http://vm.ubi-hotspot-15.ubioulu.fi/menu/soapClient.php' \
    + '?func=processEvent' \
    + '&param=%3Cevent%20type=%22changeState%22%20name=%22fullscreenoff%22%20session=%22ubi-hotspot-15%22%3E%3C/event>'
    
    # Local rabbitmq server
    queue_name = "test"
    receive_client_exchange = "logs"
    receive_client_routing_key = "logs"
    send_client_exchange = "logs"
    send_client_routing_key = "logs"
    
    # Test hotspot rabbitmq server
    rabbitmq_params = pika.ConnectionParameters(
        host = "bunny.ubioulu.fi"
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

    LIKES = 0
    DISLIKES = 0
    REPORT = 0
    
    IS_START = False
    IS_ANSWERED = False
    
    def __init__(self, url):
    
        self._connection = None
        self._channel = None
        self._consumer_tag = None
        self._url = url
        
        self._credentials = pika.PlainCredentials('middleware', '5492pn0GE884E5Ma6nO44KO0N7875W4v')
        self._parameters = pika.ConnectionParameters(self._url,
                                       5672,
                                       '/',
                                       self._credentials)
                                       
    def run(self):
        self._connection = pika.SelectConnection(parameters=self._parameters, on_open_callback=self.on_connected)
        print ' [*] Waiting for messages. To exit press CTRL+C'
        self._connection.ioloop.start()

    def stop(self):
        self._connection.close()
        self._connection.ioloop.start()

    def on_connected(self, connection):
        self._connection = connection
        self._connection.channel(self.on_channel_opened)
        print "[*] on_connected"
        
    def on_channel_opened(self, channel):
        """Called when our channel has opened"""
        self._channel = channel
        self._channel.exchange_declare(callback=self.on_exchange_declared, 
                                    exchange="lmevent",
                                    exchange_type="fanout",
                                    passive=True)
        print "[*] on_channel_opened"
        
    def on_exchange_declared(self, frame):
        self._channel.queue_declare(callback=self.on_queue_declared, 
                                    queue=self.queue_name, 
                                    durable=True,
                                    exclusive=False, 
                                    auto_delete=True)
        print "[*] on_exchange_declared"
        
    def on_queue_declared(self, frame):
        self._channel.queue_bind(callback=self.on_bind_ok, 
                                exchange="lmevent", 
                                queue=self.queue_name,
                                routing_key="fi.ubioulu.lmevent")
        print "[*] on_queue_declared"
        
    def on_bind_ok(self, frame):
        self._consumer_tag = self._channel.basic_consume(self.on_message, 
                                                        queue="test")
        print "[*] on_bind_ok"
        print frame
        self.send_message({"event":{"id":"123","operation":[{"parameter":[{"name":"fullscreenapp","type":"id"},{"name":"http:\/\/www.ubioulu.fi","type":"resource"}],"type":"setContent"}],"session":"ubi-hotspot-15","name":"fullscreenon","type":"changeState","endpoint":""}})
    
    def send_message(self, msg):           
        self._channel.basic_publish(exchange="lmevent", 
                                    routing_key="lmevent", 
                                    body=json.dumps(msg))
        print "message sent"
        
    def on_message(self, channel, deliver, properties, body):
        """Called when there is a message"""
        msgObj = json.loads(body)
        print " [x] Message received.      Type:", \
            "{0: <30}".format(msgObj.get("type")), \
            "{0: <15}".format(msgObj.get("sender")), \
            ">>", \
            "{0: >15}".format(msgObj.get("receiver"))
        return
        if msgObj.get("receiver") == "all":
            return
        
        type = msgObj.get("type")
        if type == "meta-data":
            r = requests.get(self.HOTSPOT_FULLSCREEN_ON_URL)
            print "Broadcasting speech full screen in hotspot now.", r.text
        if type == "stop_speech_transmission":
            r = requests.get(self.HOTSPOT_FULLSCREEN_OFF_URL)
            print "Stop broadcast speech.", r.text
        if type == "like":	
            global LIKES
            LIKES += 1
            print "Likes: ", LIKES
            update_likes = {"sender": "middleware", "receiver": "all", "timestamp": None, "type": "like", "data": {"likes": LIKES}}
            self._channel.basic_publish(exchange=self.send_client_exchange, 
                                        routing_key=self.send_client_routing_key, 
                                        body=json.dumps(update_likes))
            print update_likes

def start_middleware():
    middleware = Middleware("bunny.ubioulu.fi")
    try:
        middleware.run()
        
        
    except KeyboardInterrupt:
        middleware.stop()
        
        
        
if __name__ == "__main__":
    
    #Reset test hotspot to default
    #r = requests.get(Middleware.HOTSPOT_FULLSCREEN_OFF_URL)
    
    start_middleware()
    
    #channel.queue_bind(exchange=receive_client_exchange, queue=queue_name)
    
    #result_test_hotspot = channel.queue_declare(exclusive=True, auto_delete=True)
    #queue_name_test_hotspot = result_test_hotspot.method.queue
    
    #channel.queue_bind(exchange="lmevent")
    
    
    #channel.basic_consume(handleIncomingMessage, queue=queue_name, no_ack=True)
    