# sfs3-kinesis

Steps Functions with S3 side car and Kinesis stream for notifications

## Deployment

### downstream

The sample step function invokes another step function state machine during its execution. You need to install the downsteam step function as a pre-requisite.

To do so, use `npm install` followed by sls deploy` in the `downstream` directory in [this](https://github.com/d-smith/sfs3) project

### s3-for-process-data

To install:

````console
npm install
sls deploy --aws-profile <profile name>
````

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