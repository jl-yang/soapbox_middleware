import pika
import json
import requests
import uuid
import datetime
import collections
from threading import Thread, Lock, Timer
import time

from pymongo import MongoClient

SPEECH_INFO_KEY_ID = "lefttime"
SPEECH_INFO_KEY_PASSWORD = "password"
SPEECH_INFO_KEY_TOPIC = "topic"
SPEECH_INFO_KEY_NAME = "name"
SPEECH_INFO_ID_FORMAT = "%d/%m/%Y %H:%M"
COMMENT_KEY_NAME = "username"
COMMENT_KEY_CONTENT = "content"

class dbHandler:
    client = None
    db = None
    speeches = None
    likes = None
    dislikes = None
    reports = None
    comments = None
    is_debug = None
        
    def __init__(self, is_debug):
        self.client = MongoClient()
        
        self.is_debug = is_debug
        if is_debug is True:
            self.db = self.client["debug"]
        else:
            self.db = self.client["soapbox_db"]  
        #Documents in MongoDB
        self.speeches = self.db.speeches
        self.likes = self.db.likes
        self.dislikes = self.db.dislikes
        self.reports = self.db.reports
        self.comments = self.db.comments
    
    def _dt_to_string(self, dt_object):
        return dt_object.strftime(SPEECH_INFO_ID_FORMAT)         
    
    #Find corresponding speech according to password
    def delete_speech(self, password):
        speech_id = None
        speech = self.speeches.find_one({"password": password})
        if speech is not None:
            speech_id = speech.speech_id
        if speech_id is not None:
            self.speeches.delete_many({"speech_id": speech_id})
            self.likes.delete_many({"speech_id": speech_id})
            self.dislikes.delete_many({"speech_id": speech_id})
            self.reports.delete_many({"speech_id": speech_id})
            self.comments.delete_many({"speech_id": speech_id})
            return True
        else:
            return False
    
    def reset(self):
        self.client.drop_database("debug") if self.is_debug else self.client.drop_database("soapbox_db") 
    
    def find_speech(self, submit_info):
        #Speech id
        speech_id = submit_info.get(SPEECH_INFO_KEY_ID)
        if speech_id is None:
            return None
        return self.speeches.find_one({"speech_id": speech_id})
             
    #speech_id, is_reserved_speech, is_used=False, length=None, start_timestamp=None, end_timestamp=None, 
    #password, speaker_name, speech_topic
    def add_speech(self, submit_info, is_reserved_speech):
        #Parse submit_info
        speaker_name = submit_info.get(SPEECH_INFO_KEY_NAME)
        speech_topic = submit_info.get(SPEECH_INFO_KEY_TOPIC)
        password = submit_info.get(SPEECH_INFO_KEY_PASSWORD)
        start_time_str = submit_info.get(SPEECH_INFO_KEY_ID)
        
        #Save the speech starting dates and corresponding password. Use datetime object as key
        _date_object = datetime.datetime.strptime(start_time_str, SPEECH_INFO_ID_FORMAT)
        speech = {
            "speech_id": _date_object,
            "is_speech_for_reservation": is_reserved_speech,
            "status": "reserved" if is_reserved_speech else "submitted",
            "is_used": False,
            "length": None,
            "unlock_timestamp": None,
            "start_timestamp": None,
            "end_timestamp": None,
            "password": password,
            "speaker_name": speaker_name,
            "speech_topic": speech_topic,
            "submit_info": submit_info
        }        
        self.speeches.insert_one(speech)
        return _date_object
        
    def speech_lock(self, speech_id):
        result = self.speeches.update_one(
            {
                "speech_id": speech_id
            },
            {
                "$set": {
                    "status": "locked"
                }
        })
        return True if result.matched_count == 1 and result.modified_count == 1 else False
        
    def speech_unlock(self, speech_id, timestamp):
        result = self.speeches.update_one(
            {
                "speech_id": speech_id
            },
            {
                "$set": {
                    "status": "unlocked",
                    "unlock_timestamp": timestamp
                }
        })
        return True if result.matched_count == 1 and result.modified_count == 1 else False
    
    def speech_start(self, speech_id, timestamp):
        result = self.speeches.update_one(
            {
                "speech_id": speech_id
            },
            {
                "$set": {
                    "status": "ongoing",                    
                    "start_timestamp": timestamp,
                    "is_used": True
                }
        })
        return True if result.matched_count == 1 and result.modified_count == 1 else False
    
    def speech_stop(self, speech_id, timestamp):
        result = self.speeches.update_one(
            {
                "speech_id": speech_id
            },
            {
                "$set": {
                    "status": "over",
                    "stop_timestamp": timestamp
                }
        })
        return True if result.matched_count == 1 and result.modified_count == 1 else False
        
    # Tell if it is valid, and if it is for next speech    
    def validate(self, password):
        return_value = None
        #Check if there is any reservation
        if self.speeches.find().count() == 0:
            return_value = -1
        else:                   
            if self.speeches.find_one({"password": password}).count() == 1:
                #password is valid, but maybe not for the exact next speech
                return_value = 1
                #Check if it is exact next speech password
                if self.next_speech().password == password:
                    return_value = 2
            else:
                #password is not valid at all
                return_value = 0
        return return_value
        
    #Return {"speech_id": XXX, "submit_info": XXX}
    def ongoing_speech(self):
        speech = self.speeches.find_one({"status": "ongoing"}, {"_id": False})
        if speech is not None:
            return {"speech_id": self._dt_to_string(speech["speech_id"]), "submit_info": speech["submit_info"]}
        else:
            return None
        
    #next speech is the earliest unused one, is_used will be true once a speech becomes ongoing
    def next_speech(self):
        #Sort the speeches to find the earliest unused speech
        speeches = self.speeches.find({"is_used": False}, {"_id": False})
        if speeches is not None:
            speeches.sort("speech_id")
            for speech in speeches:
                speech["speech_id"] = self._dt_to_string(speech["speech_id"])
                return speech 
            return None
        else:
            return None
    
    def get_all_speeches(self):
        #Need to explicitly exclude _id as it is not JSON serializable
        speeches = self.speeches.find({}, {"_id": False})
        return_speeches = []
        if speeches is not None:
            speeches.sort("speech_id")
            for speech in speeches:
                speech["speech_id"] = self._dt_to_string(speech["speech_id"])
                return_speeches.append(speech)
            if len(return_speeches) != 0:
                return return_speeches
            else:
                return None
        else:
            return None
    
    #Only submit_info field will be returned
    def get_upcoming_speeches_for_today(self):
        speeches = self.speeches.find(
            {
                "is_used": False,
                "speech_id": {
                    "$lt": datetime.datetime.today() + datetime.timedelta(days=1), 
                    "$gt": datetime.datetime.today() + datetime.timedelta(days=-1)
                }
            },
            {
                "_id": False
            }
        )
        return_speeches = []
        #Maybe no element
        if speeches is not None:
            speeches.sort("speech_id")
            for speech in speeches:
                return_speeches.append(speech["submit_info"])
            if len(return_speeches) != 0:
                return return_speeches
            else:
                return None
        else:
            return None
            
    #Return total likes
    def like_current_speech(self, sender, timestamp):
        speech_id = self.ongoing_speech()["speech_id"]
        self.likes.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp
        })
        return self.get_speech_likes(speech_id)
        
    #Return total dislikes
    def dislike_current_speech(self, sender, timestamp):
        speech_id = self.ongoing_speech()["speech_id"]
        self.dislikes.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp
        })
        return self.get_speech_dislikes(speech_id)
    
    #Return total reports
    def report_current_speech(self, sender, timestamp):
        speech_id = self.ongoing_speech()["speech_id"]
        self.reports.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp
        })
        return self.get_speech_reports(speech_id)
    
    #Nothing to return
    def comment_current_speech(self, timestamp, sender, name, content):
        speech_id = self.ongoing_speech()["speech_id"]
        self.comments.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp,
            COMMENT_KEY_NAME: name,
            COMMENT_KEY_CONTENT: content
        })
    
    def get_speech_likes(self, speech_id):
        return self.likes.find({"speech_id": speech_id}).count()
    
    def get_speech_dislikes(self, speech_id):
        return self.dislikes.find({"speech_id": speech_id}).count()
    
    def get_speech_reports(self, speech_id):
        return self.reports.find({"speech_id": speech_id}).count()
    
    def get_speech_comments(self, speech_id):
        comments = self.comments.find({"speech_id": speech_id})
        return_comments = []
        if comments is not None:
            for comment in comments:                
                return_comments.append({
                    COMMENT_KEY_NAME: comment["name"], 
                    COMMENT_KEY_CONTENT: comment["content"]
                })
            return return_comments
        else:
            return None
    
class Middleware(object):
    
    #URL
    HOTSPOT_WEBSITE_URL = 'http://10.20.47.62/hotspots19/ubi.html'
    HOTSPOT_WEBSITE_OULU = 'http://www.ubioulu.fi'
    HOTSPOT_ADS_URL = 'http://10.20.47.62/ads19/ads.html'
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
        
        #Hotspot info
        self.hotspots = []
        
        #Database handler
        self.db = dbHandler(True) if not self.ENABLE_TEST_HOTSPOT else dbHandler(False)
    
    def clean_database(self):
        self.db.reset()
    
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
        
    
    def send(self, sender, type, data):
        if sender == "soapbox":
            self.send_soapbox(type, data)
        elif sender == "hotspot":
            self.send_hotspot(type, data)
        elif sender == "audience":
            self.send_audience(type, data)
    
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
        ts = msgObj.get("timestamp")
        
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
            
        return type, sender, receiver, data, ts
        
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
    
    def send_current_speech_info(self, sender):        
        ongoing = self.db.ongoing_speech()
        if ongoing is not None:
            self.send(sender, "current_speech_info", {"current_speech_info": ongoing["submit_info"]})
        
    def send_next_speech_info(self, sender):
        next_speech = self.db.next_speech()
        if next_speech is not None:
            self.send(sender, "next_speech_info", {"next_speech_info": next_speech["submit_info"]})
            
    def send_all_speech_info(self, sender):
        speeches = self.db.get_all_speeches()
        if speeches is not None:
            self.send(sender, "speech_infos", {"speech_infos": speeches})
            
    def send_upcoming_speech_info_today(self, sender):
        speeches = self.db.get_upcoming_speeches_for_today()
        if speeches is not None:
            self.send(sender, "upcoming_today_speeches", {"upcoming_today_speeches": speeches})
        else:
            self.send(sender, "upcoming_today_speeches", {"upcoming_today_speeches": None})
            
    def is_speech_today(self, speech_info):
        pass
        
    def is_next_speech_changed(self, old_next_speech_id, new_next_speech_id):
        pass
    
    def on_message(self, channel, deliver, properties, body):
        msgObj = json.loads(body)    
        
        type, sender, receiver, data, ts = self._print_formated_message(msgObj)     
                
        if sender == "soapbox":
            #Control broadcast in test hotspot according to first submit info from soapbox website
            if type == "register":
                _uuid = self._create_unique_uuid()
                self.soapbox["id"] = _uuid                    
                #When soapbox is down and everyone is waiting, the soapbox should give enough offers once reconnects
                self.IS_SOAPBOX_READY = True
                                
                #Send likes and dislikes updates in case soapbox is trying to reconnect
                                
                print "Current hotspots: ", self.hotspots      
                
                for hotspot in self.hotspots:
                    self.threaded_send_request_offer(hotspot["id"])
                
            elif type == "offer" and "sdp" in data and "hotspot_id" in data:
                self.send_hotspot("offer", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"]})
                
            elif type == "ice-candidate" and "ice" in data and "hotspot_id" in data:                
                self.send_hotspot("ice-candidate", {"ice": data["ice"], "hotspot_id": data["hotspot_id"]})
            
            elif type == "start_broadcast":    
                #If no datetime is provided, then by default start the next upcoming speech
                next_speech = self.db.next_speech()
                if "speech_info" not in data and next_speech is not None:
                    self.db.speech_start(next_speech["speech_id"], ts)
                elif "speech_info" in data and data["speech_info"] is not None:
                    #Start speech immediately, no speech info is submitted, should have other info later
                    self.db.speech_start(self.db.add_speech(data["speech_info"], True), ts)
                    
                #Just a message for all audience, so audience can comment now
                self.send_audience("start_broadcast", None)
                
                #Redirect all hotspots into full screen broadcast state
                if self.ENABLE_TEST_HOTSPOT is True:
                    self.start_broadcast(self.HOTSPOT_WEBSITE_URL)
            
            #Stop speech transmission in hotspot website according to message from soapbox website
            elif type == "stop_broadcast":   
                ongoing = self.db.ongoing_speech()
                if ongoing is not None:
                    self.db.speech_stop(ongoing["speech_id"], ts)
                    
                #Just a message for all audience
                self.send_audience("stop_broadcast", None)
                #Send stop message to all hotspot
                self.send_hotspot("stop_broadcast", None)                
                self.soapbox = {}
                
                #Should also redirect all hotspots back from full screen state
                if self.ENABLE_TEST_HOTSPOT is True:
                    self.stop_broadcast()
                self.IS_SOAPBOX_READY = False
                
            elif type == "ready":
                self.IS_SOAPBOX_READY = True                
                                                        
            
        if sender == "hotspot":
            if type == "register" and "name" in data:      
                _hotspot_id = self._create_unique_uuid()
                self.hotspots.append({"id": _hotspot_id, "name": data["name"]})
                self.send_hotspot("register", {"hotspot_id": _hotspot_id})
                
                ongoing = self.db.ongoing_speech()   
                if ongoing is not None:
                    #Also send speech info              
                    self.send_hotspot("current_speech_info", {"current_speech_info": ongoing["submit_info"], "hotspot_id": _hotspot_id})
                    #Also send likes, dislikes info of ongoing speech                
                    self.send_hotspot("likes", {"likes": self.db.get_speech_likes(ongoing["speech_id"]), "hotspot_id": _hotspot_id})
                    self.send_hotspot("dislikes", {"dislikes": self.db.get_speech_dislikes(ongoing["speech_id"]), "hotspot_id": _hotspot_id})
                    for comment in self.db.get_speech_comments(ongoing["speech_id"]):
                        self.send_hotspot("comment", {"comment": {"username": comment[COMMENT_KEY_NAME], "content": comment[COMMENT_KEY_CONTENT]}, "hotspot_id": _hotspot_id})
                
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
                
                
        if sender == "audience":                
            if type == "comment" and "comment" in data:
                #Print out the comment now
                print "Comment: ", data["comment"]  
                _username = data["comment"][COMMENT_KEY_NAME]
                _content = data["comment"][COMMENT_KEY_CONTENT]
                #Add comment to list
                self.db.comment_speech(self.db.ongoing_speech()["speech_id"], ts, sender, _username, _content)
                self.send_soapbox("comment", {"comment": {"username": _username, "content": _content}})
                self.send_hotspot("comment", {"comment": {"username": _username, "content": _content}})
                           
                      
        if sender == "soapbox" or sender == "audience":    
            if type == "submit" and "speech_info" in data and \
                SPEECH_INFO_KEY_ID in data["speech_info"] and \
                data["speech_info"][SPEECH_INFO_KEY_ID] is not None and \
                SPEECH_INFO_KEY_PASSWORD in data["speech_info"] and \
                data["speech_info"][SPEECH_INFO_KEY_PASSWORD] is not None:
                
                #Save it in database and send it to all hotspots and audience once they are online
                self.db.add_speech(data["speech_info"], True)               
            
            elif type == "current_speech_info":
                self.send_current_speech_info(sender)
                                
            elif type == "next_speech_info":
                self.send_next_speech_info(sender)
            
            elif type == "speech_infos":
                self.send_all_speech_info(sender)
            
            elif type == "upcoming_speeches_today":
                self.send_upcoming_speech_info_today(sender)
            
            elif type == "validation" and "password" in data:
                #Requested by soapbox or audience
                return_value = self.db.validate(data["password"])
                self.send(sender, "validation", {"validation": return_value})      
            
            elif type == "delete_speech" and "password" in data:
                success = self.db.delete_speech(data["password"])
                self.send(sender, "delete_speech", {"delete_speech": success})
            
        if sender == "hotspot" or sender == "audience":
            if sender == "hotspot" and "hotspot_id" not in data:
                return
            
            #Control likes, dislikes, reports info 
            if type == "like":	
                likes = self.db.like_current_speech(sender, ts)
                
                print "[*] Likes updated: ", likes
                self.send_soapbox("likes", {"likes": likes})
                self.send_hotspot("likes", {"likes": likes})
                self.send_audience("likes", {"likes": likes})
                
            elif type == "dislike":	
                #Add it to total
                dislikes = self.db.dislike_current_speech(sender, ts)
                                
                print "[*] Dislikes updated: ", dislikes
                self.send_soapbox("dislikes", {"dislikes": dislikes})
                self.send_hotspot("dislikes", {"dislikes": dislikes})
                self.send_audience("dislikes", {"dislikes": dislikes})
            
            elif type == "report":	
                #Add it to total
                reports = self.db.report_current_speech(sender, ts)
                
                print "[*] Reports updated: ", reports
                
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
        
        #If it is in debug mode, then database should be cleaned
        middleware.clean_database()
        
        
        
if __name__ == "__main__":
    
    start_middleware()
    
    