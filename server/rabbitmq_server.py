import pika
import json
import requests
import uuid
import datetime



class Middleware(object):
    
    #URL
    HOTSPOT_WEBSITE_URL = 'http://85.23.168.158'
    HOTSPOT_WEBSITE_OULU = 'http://www.ubioulu.fi'
    RABBITMQ_SERVER_URL = "bunny.ubioulu.fi"
    
    #Fullscreen configs on test hotspot
    HOTSPOT_FULLSCREEN_ON_URL = 'http://vm.ubi-hotspot-15.ubioulu.fi/menu/soapClient.php' \
    + '?func=processEvent' \
    + '&param=%3Cevent%20type=%22changeState%22%20name=%22fullscreenon%22%20session=%22ubi-hotspot-15%22%3E%3Coperation%20name=%22setContent%22%3E%3Cparameter%20name=%22id%22%3Efullscreenapp%3C/parameter%3E%3Cparameter%20name=%22resource%22%3E' \
    + HOTSPOT_WEBSITE_URL \
    + '%3C/parameter%3E%3C/operation%3E%3C/event%3E'
    HOTSPOT_FULLSCREEN_OFF_URL = 'http://vm.ubi-hotspot-15.ubioulu.fi/menu/soapClient.php' \
    + '?func=processEvent' \
    + '&param=%3Cevent%20type=%22changeState%22%20name=%22fullscreenoff%22%20session=%22ubi-hotspot-15%22%3E%3C/event>'
    JSON_FULLSCREEN_ON = {
        "event": {
            "id": "123",
            "operation":[{
                "parameter":[
                    {
                        "name":"fullscreenapp",
                        "type":"id"
                    },
                    {
                        "name": HOTSPOT_WEBSITE_URL,
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
    JSON_FULLSCREEN_OFF = {
        "event": {
            "id":"123",
            "session":"ubi-hotspot-15",
            "name":"fullscreenoff",
            "type":"changeState",
            "endpoint":""
        }
    }
        
    # Soapbox project exchange    
    PROJECT_EXCHANGE = "soapbox"
    PROJECT_USRNAME = "middleware"
    PROJECT_PASSWORD = "7rD7zL8RtckRzEXD"
    MIDDLEWARE_QUEUE_NAME = "logs"
    MIDDLEWARE_ROUTING_KEY = "middleware"
    SOAPBOX_ROUTING_KEY = "soapbox"
    HOTSPOT_ROUTING_KEY = "hotspot"
                
    # Test hotspot exchange. 
    ENABLE_TEST_HOTSPOT = False    
    FORCE_RESET_TEST_HOTSPOT = False #Usually it would be False, use SOAP wrapper to reset test hotspot
    TEST_HOTSPOT_ROUTING_KEY = "fi.ubioulu.lmevent" #So called queue name
    TEST_HOTSPOT_EXCHANGE = "lmevent"
    TEST_HOTSPOT_QUEUE_NAME = "lmevent"
    # Note: only this credential has access to publish message to test hotspot
    TEST_HOTSPOT_USRNAME = 'middleware'
    TEST_HOTSPOT_PASSWORD = '5492pn0GE884E5Ma6nO44KO0N7875W4v'
    
    
    
    def __init__(self):
    
        self._connection = None
        self._channel = None
        self._consumer_tag = None
        
        self._credentials = pika.PlainCredentials(self.TEST_HOTSPOT_USRNAME, self.TEST_HOTSPOT_PASSWORD)
        self._parameters = pika.ConnectionParameters(self.RABBITMQ_SERVER_URL,
                                       5672,
                                       '/',
                                       self._credentials)
                                       
        if self.FORCE_RESET_TEST_HOTSPOT is True:
            #Reset test hotspot to default
            r = requests.get(Middleware.HOTSPOT_FULLSCREEN_OFF_URL)
        
        #Soapbox info
        self.soapbox = {}
        self.offers = [] #Need to be at least one when soapbox is registered
        
        self.hotspots = []        
        #Hotspot clients info
        self._likes = 0
        self._dislikes = 0
        self._reports = 0
                                       
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
        
    def on_channel_opened(self, channel):
        """Called when our channel has opened"""
        self._channel = channel
        
        
        self._channel.exchange_declare(callback=self.on_exchange_declared, 
                                   exchange=self.TEST_HOTSPOT_EXCHANGE,
                                   exchange_type="fanout",
                                   passive=True)
        
        self._channel.exchange_declare(callback=self.on_exchange_soapbox_declared,
                                        exchange=self.PROJECT_EXCHANGE,
                                        passive=True)
    
    #Soapbox exchange    
    def on_exchange_soapbox_declared(self, frame):   
        self._channel.queue_declare(callback=self.on_queue_soapbox_declared, 
                                    queue=self.MIDDLEWARE_QUEUE_NAME, 
                                    durable=True, 
                                    exclusive=False, 
                                    auto_delete=True)
    
    def on_queue_soapbox_declared(self, frame):   
        self._channel.queue_bind(callback=self.on_bind_soapbox_ok,
                                exchange = self.PROJECT_EXCHANGE,
                                queue=self.MIDDLEWARE_QUEUE_NAME,
                                routing_key=self.MIDDLEWARE_ROUTING_KEY)
            
    def on_bind_soapbox_ok(self, frame):
        self._channel.basic_consume(self.on_message, queue=self.MIDDLEWARE_QUEUE_NAME)
        
    
    def send_soapbox(self, type, data):     
        msgObject = {
            "sender": "middleware",
            "receiver": "soapbox",
            "timestamp": datetime.datetime.now().isoformat(),
            "type": type,
            "data": data
        }
        self._channel.basic_publish(exchange=self.PROJECT_EXCHANGE, 
                                    routing_key=self.SOAPBOX_ROUTING_KEY, 
                                    body=json.dumps(msgObject))
    
    def send_hotspot(self, type, data):       
        msgObject = {
            "sender": "middleware",
            "receiver": "hotspot",
            "timestamp": datetime.datetime.now().isoformat(),
            "type": type,
            "data": data 
        }    
        self._channel.basic_publish(exchange=self.PROJECT_EXCHANGE, 
                                    routing_key=self.HOTSPOT_ROUTING_KEY, 
                                    body=json.dumps(msgObject))
                                    
    def on_message(self, channel, deliver, properties, body):
        msgObj = json.loads(body)        
        type = msgObj.get("type")
        sender = msgObj.get("sender")
        receiver = msgObj.get("receiver")
        data = msgObj.get("data")
        print " [x] Message received.      Type:", \
            "{0: <30}".format(type), \
            "{0: <15}".format(sender), \
            ">>", \
            "{0: >15}".format(receiver)
                       
        
        if sender == "soapbox":
            #Control broadcast in test hotspot according to first submit info from soapbox website
            if type == "register":
                _uuid = self._create_unique_uuid()
                self.soapbox["id"] = _uuid
                #Request an offer for possible hotspot client, which will be assigned an uuid first
                if(len(self.offers) <= len(self.hotspots)):  
                    _hotspot_id = self._create_unique_uuid()
                    self.offers.append({"id": _hotspot_id, "offer": None, "used": False})
                    self.send_soapbox("request_offer", {"hotspot_id": _hotspot_id});
            if type == "offer":
                for i, val in enumerate(self.offers):
                    if val["offer"] is None:
                        self.offers[i]["offer"] = data["sdp"]
                        break
            if type == "stop_broadcast":
                self.soapbox = {}
                self.offers = []                
            
        elif sender == "hotspot":
            #send_hotspot() 
            pass
            
            
        #Stop speech transmission in hotspot website according to message from soapbox website
        
        
        #Control likes, dislikes, reports info     
        if type == "like":	
            self._likes += 1
            print "Likes: ", self._likes
            update_likes = {"sender": "middleware", "receiver": "all", "timestamp": None, "type": "like", "data": {"likes": self._likes}}
            self.send_hotspot(update_likes)

        
    #Test hotspot    
    def on_exchange_declared(self, frame):
        self._channel.queue_declare(callback=self.on_queue_declared, 
                                    queue=self.TEST_HOTSPOT_QUEUE_NAME, 
                                    durable=True,
                                    exclusive=False, 
                                    auto_delete=True)
        
    def on_queue_declared(self, frame):
        self._channel.queue_bind(callback=self.on_bind_ok, 
                                exchange=self.TEST_HOTSPOT_EXCHANGE, 
                                queue=self.TEST_HOTSPOT_QUEUE_NAME,
                                routing_key=self.TEST_HOTSPOT_ROUTING_KEY)
        
    def on_bind_ok(self, frame):
        self._consumer_tag = self._channel.basic_consume(self.on_test_hotspot_message, 
                                                        queue=self.TEST_HOTSPOT_QUEUE_NAME)
        if self.ENABLE_TEST_HOTSPOT is True:
            self.send_test_hotspot(self.JSON_FULLSCREEN_OFF)
            
    def send_test_hotspot(self, msg):           
        self._channel.basic_publish(exchange=self.TEST_HOTSPOT_EXCHANGE, 
                                    routing_key=self.TEST_HOTSPOT_ROUTING_KEY, 
                                    body=json.dumps(msg))
    
    def on_test_hotspot_message(self, channel, deliver, properties, body):
        msgObj = json.loads(body)
        print "TEST_HOTSPOT Message: ", msgObj
    
    def _create_unique_uuid(self):
        IS_UNIQUE = False
        while IS_UNIQUE == False:
            _uuid = str(uuid.uuid4()) 
            IS_UNIQUE = True            
            #Compare with possible soapbox id first
            if self.soapbox.get("id") is not None:
                if _uuid == self.soapbox["id"]:
                    IS_UNIQUE = False
                    continue
            #Compare with already existed hotspot id
            for i, val in enumerate(self.hotspots):
                if _uuid == val["id"]:
                    IS_UNIQUE = False
                    break
            if IS_UNIQUE == True:
                return _uuid
                
def start_middleware():
    middleware = Middleware()
    try:
        middleware.run()
        
        
    except KeyboardInterrupt:
        middleware.stop()
        
        
        
if __name__ == "__main__":
    
    start_middleware()
    
    