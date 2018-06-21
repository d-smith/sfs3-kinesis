# sfs3-kinesis

Steps Functions with S3 side car and Kinesis stream for notifications

## Deployment


### s3-for-process-data

To install:

````console
npm install
sls deploy --aws-profile <profile name>
````

There's a nascent Code Pipeline to deploy the stack in this project too, but it needs to be expanded to handle packaging as well.

## Service variants

The `svcsample` directory contains two service implementations, where a service process uses a step function state machine to produce a result for the service consumer.

Clients of the service consume it via a post event, e.g.

````console
$ curl -X POST -d '{"foo":true}' localhost:3000/p1
SUCCEEDED
````

To run the service variants, `npm install` the dependencies, then node the variant you want to run.

There are two variants. The first variant (`pollingsvc.js`) uses the step functions API to instantiate the step functions state machine, then uses the step functions API to poll for the terminal state of the state machine execution.

The second variant (`svckinesis.js`) uses the step function API to instantiate the step functions state machine, then uses kinesis to read events from the stream and checks them against events of interest, completing responses for matching events.