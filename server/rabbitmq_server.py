import pika
import json

# Use localhost
mq_params = pika.ConnectionParameters(
    host         = "localhost",
    virtual_host = "/")

receive_client_exchange = "logs"
receive_client_routing_key = "logs"



def handleIncomingMessage(ch, method, properties, body):
	msgObj = json.loads(body)
	print " [x] Received %r" % (msgObj,)
	
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