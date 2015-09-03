import SimpleHTTPServer
import SocketServer

PORT = 9999

class MyHandler(SimpleHTTPServer.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
    def do_POST(self):
        self.send_response(201)

httpd = SocketServer.TCPServer(("", PORT), MyHandler)

print "serving at port", PORT
httpd.serve_forever()