import SimpleHTTPServer
import SocketServer

port = 8888

Handler = SimpleHTTPServer.SimpleHTTPRequestHandler

httpd = SocketServer.TCPServer(("", port), Handler)

print "Start"
httpd.serve_forever()