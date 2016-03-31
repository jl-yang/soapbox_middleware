#In order to make print thread-safe
#http://stackoverflow.com/questions/3029816/how-do-i-get-a-thread-safe-print-in-python-2-6

def safe_print(content):
    print "{0}\n".format(content),