import os

if __name__ == "__main__":
    print "Hello"
    while True:
        if os.path.exists("test.test") is True:
            print "Now we have it"
            break