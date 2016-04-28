import pika
import json
import requests
import uuid
import datetime
import collections
from threading import Thread, Lock, Timer
import time

from pymongo import MongoClient

from safe_print import safe_print


SPEECH_INFO_KEY_ID = "starttime"
SPEECH_INFO_KEY_PASSWORD = "password"
SPEECH_INFO_KEY_TOPIC = "topic"
SPEECH_INFO_KEY_NAME = "speaker"
#Example string from soapbox website: 16/02/2016 16:25
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
    users = None
    is_debug = None
    
    #Maximum allowed starting a reserved speech if there is some delay
    MAX_ALLOWED_SPEECH_START_DELAY_SECONDS = 5 * 60
    
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
        self.users = self.db.users
        
    def close(self):
        self.client.close()
    
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
    #launcher: soapbox or virtual
    def add_speech(self, submit_info, launcher, is_reserved_speech):
        #Parse submit_info
        speaker_name = submit_info.get(SPEECH_INFO_KEY_NAME)
        speech_topic = submit_info.get(SPEECH_INFO_KEY_TOPIC)
        password = submit_info.get(SPEECH_INFO_KEY_PASSWORD)
        start_time_str = submit_info.get(SPEECH_INFO_KEY_ID)
        
        #More validations here
        if speaker_name == "" or speech_topic == "" or password == "" or start_time_str == "":
            print "Error: some values in submit_info is missing"
            return None
        
        #Save the speech starting dates and corresponding password. Use datetime object as key
                
        _date_object = datetime.datetime.strptime(start_time_str, SPEECH_INFO_ID_FORMAT)
        speech = {
            "speech_id": _date_object,
            "launcher": launcher,
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
            "submit_info": submit_info,
            "current_users": 0
        }        
        # TODO - Calculate the length when you want to stop the speech
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
        print "Speech starts now:", speech_id 
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
        print "stoping speech"
        print timestamp
        
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
            if self.speeches.find_one({"password": password}) is not None:
                #password is valid, but maybe not for the exact next speech
                return_value = 1
                #Check if it is exact next speech password (Excluding future but not next speech, or history speech)
                next_speech = self.next_speech()
                if next_speech is not None and next_speech["password"] == password:
                    return_value = 2
            else:
                #password is not valid at all
                return_value = 0
        return return_value
        
    #Return {"speech_id": XXX, "submit_info": XXX}
    def ongoing_speech(self):
        speech = self.speeches.find_one({"status": "ongoing"}, {"_id": False})
        if speech is not None:
            return {"speech_id": speech["speech_id"], "submit_info": speech["submit_info"], "launcher": speech["launcher"]}
        else:
            return None
        
    #next speech is the earliest unused one, is_used will be true once a speech becomes ongoing
    def next_speech(self):
        #Sort the speeches to find the speech: earliest unused, and also no later than (current time - MAX_ALLOWED_SPEECH_START_DELAY_SECONDS)
        speeches = self.speeches.find(
            {
                "is_used": False,
                "speech_id": {
                    "$gt": datetime.datetime.now() - datetime.timedelta(seconds=self.MAX_ALLOWED_SPEECH_START_DELAY_SECONDS) #now is same as today()
                }
            },
            {
                "_id": False
            }
        )
        if speeches is not None:
            speeches.sort("speech_id")
            for speech in speeches:
                #speech["speech_id"] = self._dt_to_string(speech["speech_id"])
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
                    "$lt": datetime.datetime.strptime(datetime.datetime.today().strftime("%d/%m/%Y"), "%d/%m/%Y") + datetime.timedelta(days=1), 
                    "$gt": datetime.datetime.now()
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
                #return_speeches.append(speech["submit_info"])
                speech["speech_id"] = self._dt_to_string(speech["speech_id"])
                return_speeches.append(speech)
            if len(return_speeches) != 0:
                return return_speeches
            else:
                return None
        else:
            return None
    
    def add_user(self, user_identity, timestamp, count=1, gender=None, age=None):
        if self.ongoing_speech() is None:
            return None
        speech_id = self.ongoing_speech()["speech_id"]
        
        if user_identity == "audience":
            self.users.insert_one({
                "speech_id": speech_id,
                "timestamp": timestamp,
                "user_identity": user_identity,
                "gender": gender,
                "age": age,
                "action": "online"
            })
        else:
            #Insert separate user online record in users document
            self.users.insert_one({
                "speech_id": speech_id,
                "timestamp": timestamp,
                "user_identity": user_identity,
                "action": "online"
            })
            
        #Modify data in speeches document
        result = self.speeches.update_one(
            {
                "speech_id": speech_id
            },
            {
                "$inc": {
                    "current_users": count
        }})
        return self.get_speech_users(speech_id) if result.matched_count == 1 and result.modified_count == 1 else False
    
    def minus_user(self, user_identity, timestamp, count=1, gender=None, age=None):
        if self.ongoing_speech() is None:
            return None
        speech_id = self.ongoing_speech()["speech_id"]
        
        if user_identity == "audience":
            self.users.insert_one({
                "speech_id": speech_id,
                "timestamp": timestamp,
                "user_identity": user_identity,
                "gender": gender,
                "age": age,
                "action": "online"
            })
        else:
            #Insert separate user offline record in users document
            self.users.insert_one({
                "speech_id": speech_id,
                "timestamp": timestamp,
                "user_identity": user_identity,
                "action": "offline"
            })
            
        #Modify data in speeches document
        result = self.speeches.update_one(
            {
                "speech_id": speech_id
            },
            {
                "$inc": {
                    "current_users": -1 * count
        }})
        return self.get_speech_users(speech_id) if result.matched_count == 1 and result.modified_count == 1 else False
    
    #Return total likes
    def like_current_speech(self, sender, sender_name, timestamp):
        if self.ongoing_speech() is None:
            print "like error"
            return None
        speech_id = self.ongoing_speech()["speech_id"]
        self.likes.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp,
            "sender_name": sender_name,
        })
        return self.get_speech_likes(speech_id)
        
    #Return total dislikes
    def dislike_current_speech(self, sender, sender_name, timestamp):
        if self.ongoing_speech() is None:
            print "dislike error"
            return None
        speech_id = self.ongoing_speech()["speech_id"]
        self.dislikes.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp,
            "sender_name": sender_name,
        })
        return self.get_speech_dislikes(speech_id)
    
    #Return total reports
    def report_current_speech(self, sender, sender_name, timestamp):
        if self.ongoing_speech() is None:
            print "report error"
            return None
        speech_id = self.ongoing_speech()["speech_id"]
        self.reports.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp,
            "sender_name": sender_name,
        })
        return self.get_speech_reports(speech_id)
    
    #Nothing to return
    def comment_current_speech(self, timestamp, sender, sender_name, name, content):
        if self.ongoing_speech() is None:
            print "comment error"
            return None
        speech_id = self.ongoing_speech()["speech_id"]
        self.comments.insert_one({
            "speech_id": speech_id,
            "sender": sender,
            "timestamp": timestamp,
            "sender_name": sender_name,
            COMMENT_KEY_NAME: name,
            COMMENT_KEY_CONTENT: content
        })
    
    def get_speech_users(self, speech_id):
        speech = self.speeches.find_one({"speech_id": speech_id})
        if speech is not None and "current_users" in speech:
            return speech["current_users"]
        else:
            return None
    
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
                    COMMENT_KEY_NAME: comment["username"], 
                    COMMENT_KEY_CONTENT: comment["content"]
                })
            return return_comments
        else:
            return None
    
class Middleware(object):
    
    #URL
    HOTSPOT_WEBSITE_URL = 'http://10.20.218.79/hotspots21/ubi.html'
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
    VIRTUAL_ROUTING_KEY = "virtual"
    
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
        #TODO - Plus checking certain conditions of whether the user can start a speech right now 
        self.IS_SPEECH_ONGING = False
        
        #Hotspot info
        self.hotspots = []
        
        #Virtual info
        self.virtuals = []
        self.virtual_speaker_id = None
        
        #Database handler
        #self.db = dbHandler(True) if not self.ENABLE_TEST_HOTSPOT else dbHandler(False)
        self.db = dbHandler(False)
        
    def clean_database(self):
        self.db.reset()
    
    def run(self):
        self._connection = pika.SelectConnection(parameters=self._parameters, on_open_callback=self.on_connected)
        print ' [*] Waiting for messages. To exit press CTRL+C'
        self._connection.ioloop.start()

    def stop(self):
        self.db.close()
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
        
    def send_all(self, type, data):
        self.send_soapbox(type, data)
        self.send_hotspot(type, data)
        self.send_audience(type, data)
        self.send_virtual(type, data)
    
    def send(self, sender, type, data):
        if sender == "soapbox":
            self.send_soapbox(type, data)
        elif sender == "hotspot":
            self.send_hotspot(type, data)
        elif sender == "audience":
            self.send_audience(type, data)
        elif sender == "virtual":
            self.send_virtual(type, data)
    
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
        
    def send_virtual(self, type, data): 
        if data is None: 
            msgObject = {
                "sender": "middleware",
                "receiver": "virtual",
                "timestamp": datetime.datetime.now().isoformat(),
                "type": type
            }
        else:
            msgObject = {
                "sender": "middleware",
                "receiver": "virtual",
                "timestamp": datetime.datetime.now().isoformat(),
                "type": type,
                "data": data
            }
        self._channel.basic_publish(exchange=self.PROJECT_EXCHANGE, 
                                    routing_key=self.VIRTUAL_ROUTING_KEY, 
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
        
        if type != "ice-candidate" and type != "ice-candidate_hotspot":
            if is_receiving is True:
                safe_print( " [x] Message received.      Type:" + \
                    "{0: <30}".format(type) + \
                    "{0: <15}".format(sender) + \
                    ">>" + \
                    "{0: >15}".format(receiver) )
            else:
                safe_print( " [*] Message sent.          Type:" + \
                    "{0: <30}".format(type) + \
                    "{0: <15}".format(sender) + \
                    ">>" + \
                    "{0: >15}".format(receiver) )
        
        return type, sender, receiver, data, ts
        
    def _threaded_send_request_offer(self, client_id, launcher, receiver, virtual_speaker_id):
        print "Now IS_SOAPBOX_READY:", self.IS_SOAPBOX_READY
        lock = Lock()
        lock.acquire()
        try:
            while self.IS_SOAPBOX_READY != True:
                pass
            self.IS_SOAPBOX_READY = False
                        
            #Differ whether it is from virtual or soapbox
            if launcher == "soapbox":
                if receiver == "virtual":                
                    self.send_soapbox("request_offer", {"virtual_id": client_id})
                elif receiver == "hotspot":
                    self.send_soapbox("request_offer", {"hotspot_id": client_id})
            elif launcher == "virtual" and virtual_speaker_id is not None:
                if receiver == "virtual":
                    self.send_virtual("request_offer", {"receiver_id": virtual_speaker_id, "virtual_id": client_id})
                elif receiver == "hotspot":
                    self.send_virtual("request_offer", {"receiver_id": virtual_speaker_id, "hotspot_id": client_id})
        finally:
            lock.release()
    
    #Should add time-out checks to remove old requests
    def threaded_send_request_offer(self, client_id, launcher, receiver, virtual_speaker_id):        
        thread = Thread(target=self._threaded_send_request_offer, args= (client_id, launcher, receiver, virtual_speaker_id))
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
    
    #soapbox, virtual, or None (if unknown error happens, or no ongoing speech yet)
    def launcher_of_onging_speech(self):
        ongoing = self.db.ongoing_speech()
        if ongoing is not None:
            return ongoing["launcher"]
        else:
            return None
    
    def add_user(self, user_identity, timestamp, count=1, gender=None, age=None): 
        users = self.db.add_user(user_identity, timestamp, count, gender, age)
        if users is not None:                    
            self.send_all("current_users", {"current_users": users})
    
    def minus_user(self, user_identity, timestamp, count=1, gender=None, age=None):
        users = self.db.minus_user(user_identity, timestamp, count, gender, age)
        if users is not None:
            self.send_all("current_users", {"current_users": users})
    
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
                
                self.send_soapbox("register", {"soapbox_id": self.soapbox["id"]})
                
                #Send likes and dislikes updates in case soapbox is trying to reconnect
                
                print "Current hotspots: ", self.hotspots   
                
                for hotspot in self.hotspots:
                    self.threaded_send_request_offer(hotspot["id"], "soapbox", "hotspot", None)                
            
            elif type == "offer" and "sdp" in data:
                #It means virtual receiver if only receiver id exists
                if "receiver_id" in data:
                    self.send_virtual("offer", {"sdp": data["sdp"], "receiver_id": data["receiver_id"]})
                elif "hotspot_id" in data:
                    self.send_hotspot("offer", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"]})
               
            elif type == "ice-candidate" and "ice" in data:
                #It means virtual receiver if only receiver id exists
                if "receiver_id" in data:                
                    self.send_virtual("ice-candidate", {"ice": data["ice"], "receiver_id": data["receiver_id"]})
                elif "hotspot_id" in data:
                    self.send_hotspot("ice-candidate", {"ice": data["ice"], "hotspot_id": data["hotspot_id"]})
             
            elif type == "start_broadcast":                
                if self.db.ongoing_speech() is not None:
                    print "Already have an onging speech. Cannot start a speech right now!"   
                    self.send_soapbox("start_feedback", {"start_feedback": "failure", "descriptions": "Already have an onging speech"}) 
                    return
                    
                #If no data is provided, then by default start the next upcoming speech
                next_speech = self.db.next_speech()
                speech_info = None
                if "speech_info" not in data and next_speech is not None:
                    speech_info = next_speech["submit_info"]
                    self.db.speech_start(next_speech["speech_id"], ts)
                    self.send_soapbox("start_feedback", {"start_feedback": "success", "descriptions": ""}) 
                elif "speech_info" in data and data["speech_info"] is not None:
                    speech_info = data["speech_info"]
                    #Start speech immediately, no speech info is submitted, should have other info later
                    self.db.speech_start(self.db.add_speech(data["speech_info"], "soapbox", False), ts)
                    self.send_soapbox("start_feedback", {"start_feedback": "success", "descriptions": ""}) 
                    
                #Just a message for all audience, so audience can comment now
                self.send_audience("start_broadcast", None)
                
                #Tell all virtual users that a speech is starting right now
                self.send_virtual("current_speech_info", {"current_speech_info": speech_info})
                self.send_hotspot("current_speech_info", {"current_speech_info": speech_info})
                
                #Count all existing virtuals as current_users now
                virtual_audience = len(self.virtuals)
                if virtual_audience >= 1:
                    self.add_user("virtual", ts, virtual_audience)
                
                #Redirect all hotspots into full screen broadcast state
                if self.ENABLE_TEST_HOTSPOT is True:
                    self.start_broadcast(self.HOTSPOT_WEBSITE_URL)
                
                print "Current virtuals: ", self.virtuals
                #Enable virtual users
                for virtual in self.virtuals:
                    #Only those virtuals that are not speaker should request an offer
                    if virtual["id"] != self.virtual_speaker_id:
                        self.threaded_send_request_offer(virtual["id"], "soapbox", "virtual", None)
                
                #No need to detect hotspots as they are finally opened by middleware programmatically  
                    
                    
            #Stop speech transmission in hotspot website according to message from soapbox website
            elif type == "stop_broadcast" and "soapbox_id" in data:   
                ongoing = self.db.ongoing_speech()
                                
                if ongoing is not None and self.launcher_of_onging_speech() == "soapbox" and data["soapbox_id"] == self.soapbox["id"]:
                    self.db.speech_stop(ongoing["speech_id"], ts)
                else:
                    print "Either no ongoing speech, or this soapbox is not the owner of the ongoing speech"
                    
                #Just a message for all audience
                self.send_audience("stop_broadcast", None)
                #Send stop message to all hotspot
                self.send_hotspot("stop_broadcast", None)  
                #Send stop message to all virtuals
                self.send_virtual("stop_broadcast", None)
                
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
                
                #Ask all current online virtual audience to generate offers for this hotspot
                for i, virtual in enumerate(self.virtuals):
                    self.send_hotspot("request_offer_virtual", {"virtual_id": virtual["id"], "hotspot_id": _hotspot_id})                
                                    
                #Do not Request an offer for hotspot client until soapbox is on and starting broadcasting                    
                #self.threaded_send_request_offer(_hotspot_id, self.launcher_of_onging_speech(), "hotspot", self.virtual_speaker_id) 
                
            elif type == "answer" and "sdp" in data and "hotspot_id" in data:
                launcher = self.launcher_of_onging_speech()
                if launcher == "soapbox":
                    self.send_soapbox("answer", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"]})
                elif launcher == "virtual" and self.virtual_speaker_id is not None:
                    self.send_virtual("answer", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"], "receiver_id": self.virtual_speaker_id})
                
            elif type == "ice-candidate" and "ice" in data and "hotspot_id" in data:
                launcher = self.launcher_of_onging_speech()
                if launcher == "soapbox":
                    self.send_soapbox("ice-candidate", {"ice": data["ice"], "hotspot_id": data["hotspot_id"]})
                elif launcher == "virtual" and self.virtual_speaker_id is not None:
                    self.send_virtual("ice-candidate", {"ice": data["ice"], "hotspot_id": data["hotspot_id"], "receiver_id": self.virtual_speaker_id})
            
            elif type == "unregister":
                if "hotspot_id" not in data:
                    print "Unknown hotspot offline."
                else:
                    for i, hotspot in enumerate(self.hotspots):
                        if hotspot["id"] == data["hotspot_id"]:
                            self.hotspots.pop(i)
                            break
                    #This should be fixed by middleware api
                    self.send_soapbox("unregister", {"hotspot_id": data["hotspot_id"]})
            
            #From hotspot to virtual
            elif type == "offer_hotspot" and "sdp" in data and "hotspot_id" in data and "receiver_id" in data:
                #Send it to virtual
                self.send_virtual("offer_hotspot", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"], "receiver_id": data["receiver_id"]})
            
            #From hotspot to virtual
            elif type == "ice-candidate_hotspot" and "ice" in data and "hotspot_id" in data and "receiver_id" in data:
                self.send_virtual("ice-candidate_hotspot", {"ice": data["ice"], "hotspot_id": data["hotspot_id"], "receiver_id": data["receiver_id"]})
                
        if sender == "audience" or sender == "virtual":                
            if type == "comment" and "comment" in data:
                if "virtual_id" not in data and "audience_id" not in data:
                    return
            
                #Print out the comment now
                print "Comment: ", data["comment"]  
                _username = data["comment"][COMMENT_KEY_NAME]
                _content = data["comment"][COMMENT_KEY_CONTENT]
                
                if sender == "virtual":
                    name = self._id_2_name(data["virtual_id"], self.virtuals)
                elif sender == "audience":
                    name = data["audience"]
                
                #Add comment to list
                #Specify identity of the virtual user
                if sender == "audience":
                    self.db.comment_current_speech(ts, sender, name, _username, _content)
                else:
                    #Virtual speaker is commenting on its own speech
                    if self.virtual_speaker_id is not None and "virtual_id" in data and self.virtual_speaker_id == data["virtual_id"]:
                        self.db.comment_current_speech(ts, "virtual-speaker", name, _username, _content)
                    else:
                        self.db.comment_current_speech(ts, "virtual-audience", name, _username, _content)
                        
                self.send_soapbox("comment", {"comment": {"username": _username, "content": _content}})
                self.send_hotspot("comment", {"comment": {"username": _username, "content": _content}})
                
                #Won't send virtual users comments when the speech is given by virtual speaker
                if sender == "virtual":
                        return
                self.send_virtual("comment", {"comment": {"username": _username, "content": _content}})
                
            elif type == "online":
                if sender == "audience":
                    if "audience_id" not in data or "age" not in data or "gender" not in data:
                        return
                        
                self.add_user(sender, ts, 1, data["gender"], data["age"])
                
            elif type == "offline":
                if sender == "audience":
                        if "audience_id" not in data or "age" not in data or "gender" not in data:
                            return
                            
                self.minus_user(sender, ts, 1, data["gender"], data["age"])                
            
        if sender == "soapbox" or sender == "audience":    
            if type == "submit" and "speech_info" in data and \
                SPEECH_INFO_KEY_ID in data["speech_info"] and \
                data["speech_info"][SPEECH_INFO_KEY_ID] is not None and \
                SPEECH_INFO_KEY_PASSWORD in data["speech_info"] and \
                data["speech_info"][SPEECH_INFO_KEY_PASSWORD] is not None:
                
                #Save it in database and send it to all hotspots and audience once they are online
                self.db.add_speech(data["speech_info"], sender, True)               
            
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
            
        if sender == "virtual":
            if type == "register" and "name" in data: 
                _virtual_id = self._create_unique_uuid()
                self.virtuals.append({"id": _virtual_id, "name": data["name"]})
                #Need to send this registered id to the exact virtual that is registering, use unique name field from virtual caller
                self.send_virtual("register", {"receiver_id": _virtual_id, "name": data["name"]})
                
                #Send the list of online hotspots to virtual so that they can generate multiple offers for each hotspot
                for i, hotspot in enumerate(self.hotspots):
                    self.send_hotspot("request_offer_virtual", {"virtual_id": _virtual_id, "hotspot_id": hotspot["id"]})                
                
                ongoing = self.db.ongoing_speech()   
                if ongoing is not None:
                    #Add itself as a new user to current speech
                    self.add_user("virtual", ts)
                    
                    #Also send speech info              
                    self.send_virtual("current_speech_info", {"current_speech_info": ongoing["submit_info"], "receiver_id": _virtual_id})
                    
                    #Also send likes, dislikes info of ongoing speech                
                    self.send_virtual("likes", {"likes": self.db.get_speech_likes(ongoing["speech_id"]), "receiver_id": _virtual_id})
                    self.send_virtual("dislikes", {"dislikes": self.db.get_speech_dislikes(ongoing["speech_id"]), "receiver_id": _virtual_id})
                    
                    for comment in self.db.get_speech_comments(ongoing["speech_id"]):
                        self.send_virtual("comment", {"comment": {"username": comment[COMMENT_KEY_NAME], "content": comment[COMMENT_KEY_CONTENT]}, "receiver_id": _virtual_id})
                                                                    
                    #Request an offer for virtual client   
                    self.threaded_send_request_offer(_virtual_id, self.launcher_of_onging_speech(), "virtual", self.virtual_speaker_id) 
                
            elif type == "answer_hotspot" and "sdp" in data and "virtual_id" in data and "hotspot_id" in data:
                #Send it to hotspot
                self.send_hotspot("answer_hotspot", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"], "virtual_id": data["virtual_id"]})
                
            elif type == "ice-candidate_hotspot" and "ice" in data and "virtual_id" in data and "hotspot_id" in data:
                #Send it to hotspot
                self.send_hotspot("ice-candidate_hotspot", {"ice": data["ice"], "hotspot_id": data["hotspot_id"], "virtual_id": data["virtual_id"]})
                
            #Only receiver will send this message to middleware
            elif type == "unregister":
                if "virtual_id" not in data:
                    print "Unknown virtual offline."
                #Do as a normal hotspot like
                else:
                    for i, virtual in enumerate(self.virtuals):
                        if virtual["id"] == data["virtual_id"]:
                            self.virtuals.pop(i)
                            #Remove this virtual as current user
                            self.minus_user("virtual", ts)
                            break
                    if self.virtual_speaker_id is not None:
                        self.send_virtual("unregister", {"receiver_id": self.virtual_speaker_id, "virtual_id": data["virtual_id"]})
                    elif self.launcher_of_onging_speech == "soapbox":
                        self.send_soapbox("unregister", {"virtual_id": data["virtual_id"]})
                        
            elif type == "start_broadcast" and "virtual_id" in data:
                if self.virtual_speaker_id is not None and self.virtual_speaker_id != data["virtual_id"]:
                    print "Cannot start a speech right now"
                    self.send_virtual("start_feedback", {"start_feedback": "failure", "descriptions": "Already have an onging speech", "receiver_id": data["virtual_id"]}) 
                    return
                elif self.db.ongoing_speech() is not None:
                    print "Cannot start a speech right now"
                    self.send_virtual("start_feedback", {"start_feedback": "failure", "descriptions": "Already have an onging speech", "receiver_id": data["virtual_id"]}) 
                    return
                #This is important. 
                self.IS_SOAPBOX_READY = True
                
                #If no data is provided, then by default start the next upcoming speech
                next_speech = self.db.next_speech()
                
                #Only consider starting a speech right now
                if "speech_info" in data and data["speech_info"] is not None :
                    #Start speech immediately, no speech info is submitted, should have other info later
                    self.db.speech_start(self.db.add_speech(data["speech_info"], "virtual", True), ts)
                    self.send_virtual("start_feedback", {"start_feedback": "success", "descriptions": "", "receiver_id": data["virtual_id"]}) 
                    
                    #Store the id as virtual_speaker_id
                    self.virtual_speaker_id = data["virtual_id"]
                    
                    #Just a message for all audience, so audience can comment now
                    self.send_audience("start_broadcast", None)
                    
                    #broadcast video to hotspot now, virtual will add its stream using client API
                    self.send_hotspot("start_broadcast", {"virtual_id": data["virtual_id"]})
                    
                    for hotspot in self.hotspots:
                        self.threaded_send_request_offer(hotspot["id"], self.launcher_of_onging_speech(), "hotspot", self.virtual_speaker_id) 
                                    
                    for virtual in self.virtuals:
                        #Only those virtuals that are not speaker should request an offer
                        if virtual["id"] != self.virtual_speaker_id:
                            self.threaded_send_request_offer(virtual["id"], self.launcher_of_onging_speech(), "virtual", self.virtual_speaker_id)
                                
            #Stop speech transmission in hotspot website according to message from soapbox website
            elif type == "stop_broadcast":   
                print "\nTrying to stop right now\n"
                print self.virtual_speaker_id
                if "virtual_id" in data and self.virtual_speaker_id is not None and data["virtual_id"] == self.virtual_speaker_id:
                    
                    ongoing = self.db.ongoing_speech()
                    if ongoing is not None:
                        self.db.speech_stop(ongoing["speech_id"], ts)
                    
                    #Just a message for all audience
                    self.send_audience("stop_broadcast", None)
                    #Send stop message to all hotspot
                    self.send_hotspot("stop_broadcast", None)   
                    #Send stop message to all virtuals
                    self.send_virtual("stop_broadcast", {"virtual_id": self.virtual_speaker_id})
                    self.virtual_speaker_id = None
                #else:
                    #Other virtual clients should handle this 
                    
                    
                #self.IS_SOAPBOX_READY = False
            
            #This is from a virtual speaker
            elif type == "offer" and "sdp" in data:
                if "virtual_id" in data and data["virtual_id"] == self.virtual_speaker_id \
                    and "receiver_id" in data:
                    self.send_virtual("offer", {"sdp": data["sdp"], "receiver_id": data["receiver_id"]})
                elif "hotspot_id" in data:
                    self.send_hotspot("offer", {"sdp": data["sdp"], "hotspot_id": data["hotspot_id"]})
                
            elif type == "ice-candidate" and "ice" in data:
                if "virtual_id" in data and data["virtual_id"] == self.virtual_speaker_id \
                    and "receiver_id" in data:                
                    self.send_virtual("ice-candidate", {"ice": data["ice"], "receiver_id": data["receiver_id"]})
                elif "hotspot_id" in data:
                    self.send_hotspot("ice-candidate", {"ice": data["ice"], "hotspot_id": data["hotspot_id"]})
                    
            elif type == "ready":
                self.IS_SOAPBOX_READY = True        
            
            #This is from a virtual receiver client
            elif type == "answer" and "sdp" in data and self.virtual_speaker_id is not None:
                if "receiver_id" not in data and "virtual_id" in data:
                    self.send_virtual("answer", {"sdp": data["sdp"], "receiver_id": self.virtual_speaker_id, "virtual_id": data["virtual_id"]})
                elif "hotspot_id" in data:
                    self.send_virtual("answer", {"sdp": data["sdp"], "receiver_id": self.virtual_speaker_id, "hotspot_id": data["hotspot_id"]})
            #For soapbox speaker
            elif type == "answer" and "sdp" in data and self.virtual_speaker_id is None and "virtual_id" in data:
                self.send_soapbox("answer", {"sdp": data["sdp"], "virtual_id": data["virtual_id"]})
                
            elif type == "ice-candidate" and "ice" in data and self.virtual_speaker_id is not None:
                if "receiver_id" not in data and "virtual_id" in data:
                    self.send_virtual("ice-candidate", {"ice": data["ice"], "receiver_id": self.virtual_speaker_id, "virtual_id": data["virtual_id"]})
                elif "hotspot_id" in data:
                    self.send_virtual("ice-candidate", {"ice": data["ice"], "receiver_id": self.virtual_speaker_id, "hotspot_id": data["hotspot_id"]})
            elif type == "ice-candidate" and "ice" in data and self.virtual_speaker_id is None and "virtual_id" in data:
                self.send_soapbox("ice-candidate", {"ice": data["ice"], "virtual_id": data["virtual_id"]})
                
        #This part must be the end, otherwise will generate unknown errors
        if sender == "hotspot" or sender == "audience" or sender == "virtual":
            if sender == "hotspot" and "hotspot_id" not in data:
                return
            
            if sender == "virtual" and "virtual_id" not in data:
                return
            
            if sender == "audience":
                if "audience_id" not in data or "gender" not in data or "age" not in data:
                    return
            
            if sender == "hotspot":
                name = self._id_2_name(data["hotspot_id"], self.hotspots)
            elif sender == "virtual":
                name = self._id_2_name(data["virtual_id"], self.virtuals)
            elif sender == "audience":
                name = data["audience_id"]        
            
            #Control likes, dislikes, reports info 
            if type == "like":	
                likes = self.db.like_current_speech(sender, name, ts)
                
                print "[*] Likes updated: ", likes
                if likes is not None:
                    self.send_soapbox("likes", {"likes": likes})
                    self.send_hotspot("likes", {"likes": likes})
                    self.send_audience("likes", {"likes": likes})
                    #Won't send virtual users when the speech is given by virtual speaker
                    if sender == "virtual":
                        return
                    self.send_virtual("likes", {"likes": likes})
                
            elif type == "dislike":	
                #Add it to total
                dislikes = self.db.dislike_current_speech(sender, name, ts)
                                
                print "[*] Dislikes updated: ", dislikes
                if dislikes is not None:
                    self.send_soapbox("dislikes", {"dislikes": dislikes})
                    self.send_hotspot("dislikes", {"dislikes": dislikes})
                    self.send_audience("dislikes", {"dislikes": dislikes})
                    #Won't send virtual users when the speech is given by virtual speaker
                    if sender == "virtual":
                        return
                    self.send_virtual("dislikes", {"dislikes": dislikes})
                
            elif type == "report":	
                #Add it to total
                reports = self.db.report_current_speech(sender, name, ts)
                
                print "[*] Reports updated: ", reports
                
                if reports is not None:
                    self.send_soapbox("reports", {"reports": reports})
                    self.send_hotspot("reports", {"reports": reports})
                    self.send_audience("reports", {"reports": reports})
                    #Won't send virtual users when the speech is given by virtual speaker
                    if sender == "virtual":
                        return
                    self.send_virtual("reports", {"reports": reports})
    
    def _id_2_name(self, id, array):
        for item in array:
            if item["id"] == id:
                return item["name"]
        return None
        
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
        #middleware.clean_database()
        
        
        
if __name__ == "__main__":
    
    start_middleware()
    
    