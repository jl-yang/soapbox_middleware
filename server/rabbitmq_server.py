import pika
import json
import requests
import uuid
import datetime
import collections
from threading import Thread, Lock
import time


class Middleware(object):
    
    #URL
    HOTSPOT_WEBSITE_URL = 'http://10.20.43.233/hotspots10/ubi.html'
    HOTSPOT_WEBSITE_OULU = 'http://www.ubioulu.fi'
    HOTSPOT_ADS_URL = 'http://10.20.43.233/ads10/ads.html'
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
    
    
    # Soapbox project exchange    
    PROJECT_EXCHANGE = "soapbox"
    PROJECT_USRNAME = "middleware"
    PROJECT_PASSWORD = "7rD7zL8RtckRzEXD"
    MIDDLEWARE_QUEUE_NAME = "logs"
    MIDDLEWARE_ROUTING_KEY = "middleware"
    SOAPBOX_ROUTING_KEY = "soapbox"
    HOTSPOT_ROUTING_KEY = "hotspot"
    AUDIENCE_ROUTING_KEY = "audience"
    
    # Test hotspot exchange. 
    ENABLE_TEST_HOTSPOT = False    
    FORCE_RESET_TEST_HOTSPOT = False #Usually it would be False, use SOAP wrapper to reset test hotspot
    TEST_HOTSPOT_ROUTING_KEY = "fi.ubioulu.lmevent" #So called queue name
    TEST_HOTSPOT_EXCHANGE = "lmevent"
    TEST_HOTSPOT_QUEUE_NAME = "lmevent"
    # Note: only this credential has access to publish message to test hotspot
    TEST_HOTSPOT_USRNAME = 'middleware'
    TEST_HOTSPOT_PASSWORD = '5492pn0GE884E5Ma6nO44KO0N7875W4v'
    #This amount relates to how many offers the soapbox needs to provide at the beginning, for possible transmission
    ALLOCATE_HOTSPOT_AMOUNT = 1
    
    def full_screen_on(self, url):
        return {
            "event": {
                "id": "123",
                "operation":[{
                    "parameter":[
                        {
                            "name":"fullscreenapp",
                            "type":"id"
                        },
                        {
                            "name": url,
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
    
    def full_screen_off(self):
        return {
            "event": {
                "id":"123",
                "session":"ubi-hotspot-15",
                "name":"fullscreenoff",
                "type":"changeState",
                "endpoint":""
            }
        }
    
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
        self.IS_SOAPBOX_READY = True
        self.request_offer_threads = []
        self.speech_info = None
        self.comments = []
        
        #Hotspot clients info
        self.hotspots = []    
        self._likes = {
            "total": 0,
            "likes": {}
        }
        self._dislikes = {
            "total": 0,
            "dislikes": {}
        }
        self._reports = {
            "total": 0,
            "reports": {}
        }
        self._reservations = {}
        
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
        if data is None: 
            msgObject = {
                "sender": "middleware",
                "receiver": "soapbox",
                "timestamp": datetime.datetime.now().isoformat(),
                "type": type
            }
        else:
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
        self._print_formated_message(msgObject, False) 
    
    def send_hotspot(self, type, data):       
        if data is None: 
            msgObject = {
                "sender": "middleware",
                "receiver": "hotspot",
                "timestamp": datetime.datetime.now().isoformat(),
                "type": type
            }    
        else:
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
        self._print_formated_message(msgObject, False)
    
    def send_audience(self, type, data):       
        if data is None:
           msgObject = {
                "sender": "middleware",
                "receiver": "audience",
                "timestamp": datetime.datetime.now().isoformat(),
                "type": type
            }    
        else:
            msgObject = {
                "sender": "middleware",
                "receiver": "audience",
                "timestamp": datetime.datetime.now().isoformat(),
                "type": type,
                "data": data 
            }    
        self._channel.basic_publish(exchange=self.PROJECT_EXCHANGE, 
                                    routing_key=self.AUDIENCE_ROUTING_KEY, 
                                    body=json.dumps(msgObject))        
        self._print_formated_message(msgObject, False)
    
    def start_waiting_broadcast(self):
        #Turn to full screen mode now to another ads website
        pass
    
    def stop_waiting_broadcast(self):
        #This should be controlled by a timer which takes the time value from speech info, and when it countdowns to zero, this method will be called 
        pass
        
    def start_broadcast(self, url):
        self._channel.basic_publish(exchange=self.TEST_HOTSPOT_EXCHANGE,
                                    routing_key=self.TEST_HOTSPOT_ROUTING_KEY,
                                    body=json.dumps(self.full_screen_on(url)))
        print " [*] Message sent about starting broadcasting in hotspot"
    
    def stop_broadcast(self):
        self._channel.basic_publish(exchange=self.TEST_HOTSPOT_EXCHANGE,
                                    routing_key=self.TEST_HOTSPOT_ROUTING_KEY,
                                    body=json.dumps(self.full_screen_off()))
        print " [*] Message sent about stopping broadcasting in hotspot"
        
    def _print_formated_message(self, msgObj, is_receiving=True):
        type = msgObj.get("type")
        sender = msgObj.get("sender")
        receiver = msgObj.get("receiver")
        data = msgObj.get("data")
        if type != "ice-candidate":
            if is_receiving is True:
                print " [x] Message received.      Type:", \
                    "{0: <30}".format(type), \
                    "{0: <15}".format(sender), \
                    ">>", \
                    "{0: >15}".format(receiver)
            else:
                print " [*] Message sent.          Type:", \
                    "{0: <30}".format(type), \
                    "{0: <15}".format(sender), \
                    ">>", \
                    "{0: >15}".format(receiver)
            
        return type, sender, receiver, data
        
    def _threaded_send_request_offer(self, id):
        lock = Lock()
        lock.acquire()
        try:
            while self.IS_SOAPBOX_READY != True:
                pass
            self.IS_SOAPBOX_READY = False
            self.send_soapbox("request_offer", {"hotspot_id": id});  
        finally:
            lock.release()
    
    def threaded_send_request_offer(self, id):        
        thread = Thread(target=self._threaded_send_request_offer, args= (id,))
        thread.setDaemon(True)        
        thread.start()
        
        self.request_offer_threads.append(thread)
        
    def on_message(self, channel, deliver, properties, body):
        msgObj = json.loads(body)    
        
        type, sender, receiver, data = self._print_formated_message(msgObj)     
                
        if sender == "soapbox":
            #Control broadcast in test hotspot according to first submit info from soapbox website
            if type == "register":
                _uuid = self._create_unique_uuid()
                self.soapbox["id"] = _uuid                    
                #When soapbox is down and everyone is waiting, the soapbox should give enough offers once reconnects
                self.IS_SOAPBOX_READY = True
                
                #Should send these info first
                self.send_soapbox("likes", {"likes": self._likes["total"]})
                self.send_soapbox("dislikes", {"dislikes": self._dislikes["total"]})
                self.send_soapbox("reports", {"reports": self._reports["total"]})
                # _keys = self._reservations.keys();
                # _dates = []
                # if _keys:
                    # for key in _keys:
                        # date = key.split()
                        # _dates.append(date[0])
                
                self.send_soapbox("reservations", {"reservations": [datetime.datetime.strftime(ts, "%d/%m/%Y %H:%M") for ts in self._reservations.keys()]})
                
                print "Current hotspots: ", self.hotspots                
                for hotspot in self.hotspots:
                    self.threaded_send_request_offer(hotspot["id"])
                #Send likes and dislikes updates in case soapbox is trying to reconnect
                
            elif type == "offer" and "sdp" in data and "hotspot_id" in data:
                self.send_hotspot("offer", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"]})
                
            elif type == "ice-candidate" and "ice" in data and "hotspot_id" in data:                
                self.send_hotspot("ice-candidate", {"ice": data["ice"], "hotspot_id": data["hotspot_id"]})
            
            elif type == "start_broadcast":                
                #Just a message for all audience
                self.send_audience("start_broadcast", None)
                #Redirect all hotspots into full screen broadcast state
                if self.ENABLE_TEST_HOTSPOT is True:
                    self.stop_broadcast()
                    self.start_broadcast(self.HOTSPOT_WEBSITE_URL)
            
            #Stop speech transmission in hotspot website according to message from soapbox website
            elif type == "stop_broadcast":    
                #Just a message for all audience
                self.send_audience("stop_broadcast", None)
                #Send stop message to all hotspot
                self.send_hotspot("stop_broadcast", None)                
                self.soapbox = {}
                #Save data of likes, dislikes, reports and clear them
                self._likes["likes"] = {}
                self._likes["total"] = 0
                self._dislikes["dislikes"] = {}
                self._dislikes["total"] = 0
                self._reports["reports"] = {}
                self._reports["total"] = 0
                #Save comments and clear them
                self.comments = []
                #Should also redirect all hotspots back from full screen state
                if self.ENABLE_TEST_HOTSPOT is True:
                    self.stop_broadcast()
                    
            elif type == "ready":
                self.IS_SOAPBOX_READY = True
            
            elif type == "meta-data" and "speech_info" in data and "lefttime" in data["speech_info"] and "password" in data["speech_info"]:
                #Save it locally and send it to all hotspots and audience once they are online
                self.speech_info = data["speech_info"]
                #Save the speech reservation dates and corresponding password. Use datetime object as key
                _date_object = datetime.datetime.strptime(data["speech_info"]["lefttime"], "%d/%m/%Y %H:%M")
                self._reservations[_date_object] = data["speech_info"]["password"]
                
                if self.ENABLE_TEST_HOTSPOT is True:
                    self.start_broadcast(self.HOTSPOT_ADS_URL)
                    self.send_audience("meta-data", {"speech_info": self.speech_info})
            
            elif type == "next_speech_info":
                #Requested by soapbox
                self.send_soapbox("next_speech_info", {"speech_info": self.speech_info})
            
            elif type == "validation" and "password" in data:
                #Requested by soapbox 
                #Check if there is any reservation
                if len(self._reservations) == 0:
                    self.send_soapbox("validation", {"validation": False, "message": "No reservations yet"})
                else:   
                    #Use ordered dictionary to get latest reservation
                    od = collections.OrderedDict(sorted(self._reservations.items()))
                    #Latest password is the valid one 
                    correct_password = od[od.keys()[-1]]
                    if data["password"] == correct_password:
                        self.send_soapbox("validation", {"validation": True})
                    else:
                        self.send_soapbox("validation", {"validation": False})
            
        elif sender == "hotspot":
            if type == "register" and "name" in data:      
                _hotspot_id = self._create_unique_uuid()
                self.hotspots.append({"id": _hotspot_id, "name": data["name"]})
                self.send_hotspot("register", {"hotspot_id": _hotspot_id})
                #Also send speech info 
                if self.speech_info is not None:
                    self.send_hotspot("meta-data", {"speech_info": self.speech_info, "hotspot_id": _hotspot_id})
                #Also send likes, dislikes info 
                self.send_hotspot("likes", {"likes": self._likes["total"], "hotspot_id": _hotspot_id})
                self.send_hotspot("dislikes", {"dislikes": self._dislikes["total"], "hotspot_id": _hotspot_id})
                for comment in self.comments:
                    self.send_hotspot("comment", {"comment": {"username": comment["username"], "content": comment["content"]}, "hotspot_id": _hotspot_id})
                
                #Request an offer for hotspot client                    
                self.threaded_send_request_offer(_hotspot_id) 
                 
            elif type == "answer" and "sdp" in data and "hotspot_id" in data:
                self.send_soapbox("answer", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"]})
                
            elif type == "ice-candidate" and "ice" in data and "hotspot_id" in data:
                self.send_soapbox("ice-candidate", {"ice": data["ice"], "hotspot_id": data["hotspot_id"]})
            
            elif type == "unregister":
                if "hotspot_id" not in data:
                    print "Unknown hotspot offline."
                else:
                    for i, hotspot in enumerate(self.hotspots):
                        if hotspot["id"] == data["hotspot_id"]:
                            self.hotspots.pop(i)
                            break
                    #This should be fixed by middleware api
                    if "hotspot_id" in data:
                        self.send_soapbox("unregister", {"hotspot_id": data["hotspot_id"]})
                    
            #Control likes, dislikes, reports info 
            elif type == "like" and "hotspot_id" in data:	
                _id = data["hotspot_id"]
                #Add it to specific hotspot subdirectory
                if _id not in self._likes["likes"]:
                    self._likes["likes"][_id] = 1
                else:
                    self._likes["likes"][_id] += 1
                #Add it to total
                self._likes["total"] += 1
                print "[*] Likes updated: ", self._likes["total"]
                self.send_soapbox("likes", {"likes": self._likes["total"]})
                self.send_hotspot("likes", {"likes": self._likes["total"]})
                self.send_audience("likes", {"likes": self._likes["total"]})
                
            elif type == "dislike" and "hotspot_id" in data:	
                _id = data["hotspot_id"]
                #Add it to specific hotspot subdirectory
                if _id not in self._dislikes["dislikes"]:
                    self._dislikes["dislikes"][_id] = 1
                else:
                    self._dislikes["dislikes"][_id] += 1
                #Add it to total
                self._dislikes["total"] += 1
                print "[*] Dislikes updated: ", self._dislikes["total"]
                self.send_soapbox("dislikes", {"dislikes": self._dislikes["total"]})
                self.send_hotspot("dislikes", {"dislikes": self._dislikes["total"]})
                self.send_audience("dislikes", {"dislikes": self._dislikes["total"]})
            
            elif type == "report" and "hotspot_id" in data:	
                _id = data["hotspot_id"]
                #Add it to specific hotspot subdirectory
                if _id not in self._reports["reports"]:
                    self._reports["reports"][_id] = 1
                else:
                    self._reports["reports"][_id] += 1
                #Add it to total
                self._reports["total"] += 1
                print "[*] Reports updated: ", self._reports["total"]
        
        elif sender == "audience":                
            if type == "comment" and "comment" in data:
                #Print out the comment now
                print "Comment: ", data["comment"]  
                _username = data["comment"]["username"]
                _content = data["comment"]["content"]
                #Add comment to list
                self.comments.append({"username": _username, "content": _content})
                self.send_soapbox("comment", {"comment": {"username": _username, "content": _content}})
                self.send_hotspot("comment", {"comment": {"username": _username, "content": _content}})
                
            elif type == "current_speech_info":
                #Send speech info if there is any
                if self.speech_info is not None:
                    self.send_audience("meta-data", {"speech_info": self.speech_info})
                    #Just to confirm that broadcast has been started, so audience can comment now
                    self.send_audience("start_broadcast", None)
                
            elif type == "like":
                self._likes["total"] += 1
                print "[*] Likes updated: ", self._likes["total"]
                self.send_soapbox("likes", {"likes": self._likes["total"]})
                self.send_hotspot("likes", {"likes": self._likes["total"]})
                self.send_audience("likes", {"likes": self._likes["total"]})
            
            elif type == "dislike":
                self._dislikes["total"] += 1
                print "[*] Dislikes updated: ", self._dislikes["total"]
                self.send_soapbox("dislikes", {"dislikes": self._dislikes["total"]})
                self.send_hotspot("dislikes", {"dislikes": self._dislikes["total"]})
                self.send_audience("dislikes", {"dislikes": self._dislikes["total"]})
                
            elif type == "report":
                self._reports["total"] += 1
                print "[*] Reports updated: ", self._reports["total"]
            
            elif type == "meta-data" and "speech_info" in data:
                #To-do
                self.speech_info = data["speech_info"]
                self.send_audience("meta-data", {"speech_info": self.speech_info})
                #Make hotspot changing to full screen ads mode
                if self.ENABLE_TEST_HOTSPOT is True:
                    self.start_broadcast(self.HOTSPOT_ADS_URL)
                
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
            self.send_test_hotspot(self.full_screen_off())
            
    def send_test_hotspot(self, msg):           
        self._channel.basic_publish(exchange=self.TEST_HOTSPOT_EXCHANGE, 
                                    routing_key=self.TEST_HOTSPOT_ROUTING_KEY, 
                                    body=json.dumps(msg))
    
    def on_test_hotspot_message(self, channel, deliver, properties, body):
        # msgObj = json.loads(body)
        # "TEST_HOTSPOT Message received: ", msgObj
        pass
    
    def _create_unique_uuid(self):
        IS_UNIQUE = False
        while IS_UNIQUE == False:
            _uuid = str(uuid.uuid4()) 
            IS_UNIQUE = True            
            #Compare with possible soapbox id first
            if "id" in self.soapbox:
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
        #No need to stop threads manually since they are set as daemon threads
        #for thread in middleware.request_offer_threads:
        #    thread._stop()
        
    except KeyboardInterrupt:
        middleware.stop()
        
        
if __name__ == "__main__":
    
    start_middleware()
    
    