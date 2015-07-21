set homedrive=C:
set homepath=/Windows

echo %homedrive%
echo %homepath%

rabbitmq-server -detached

echo Done starting rabbitmq server

pause