const express = require('express');
const timeout = require('connect-timeout');
const app = express();
const bodyParser = require('body-parser');
const AWS = require('aws-sdk');

var proxy = require('proxy-agent');    
AWS.config.update({
    httpOptions: { agent: proxy(process.env.HTTPS_PROXY) }
});

const stepFunctions = new AWS.StepFunctions();
const S3 = new AWS.S3();
const kinesis = new AWS.Kinesis();

const FlakeIdGen = require('flake-idgen')
    , intformat = require('biguint-format')
    , generator = new FlakeIdGen;


const invokeIt = async (input, serviceResponse) => {

    console.log(`invoke state machine with input ${input}`);

    //Generate a txn id we'll use as the object in s3 to store state
    //data, content, etc.
    let txnId = intformat(generator.next(), 'hex',{prefix:'0x'});
    console.log(`txnId: ${txnId}`);
    
    //Drop the state machine input into s3
    let params = {
        Body: JSON.stringify(input),
        Key: txnId,
        ServerSideEncryption: "AES256",
        Bucket: process.env.BUCKET_NAME
    };

    try {
        let response = await S3.putObject(params).promise();
        console.log(response);
    } catch(theError) {
        console.log(JSON.stringify(theError));
        serviceResponse.status(500).send('Unable to write transaction input');
        return;
    }

    //Instantiate the process
    let sfparams = {
        stateMachineArn: process.env.STEP_FN_ARN,
        input: JSON.stringify({processData: txnId})
    }

    let result = await stepFunctions.startExecution(sfparams).promise();
    console.log(`step fn result: ${JSON.stringify(result)}`);
    let tuple = {
        response: serviceResponse,
        executionArn: result['executionArn']
    }

    txnToResponseMap.set(txnId, tuple);
}

// Stick the express response objects in a map, so we can
// lookup and complete the response when the process state
// is published.
let txnToResponseMap = new Map();

// Fallback - if iot connection service fails, poll for 
// state machine completion
let pollForResults = false;

// When we toggle back from polling to events, there may be 
// some results we are polling for that might complete during
// the transition from polling back to events during the 
// interval between the connection being re-establish followed
// by subscriptions being restored. We use this map to
// keep track of out standing requests during the transition.
let transitionTxnsMap = new Map();

const headersSentForTransaction = (txnId, response, txnMap) => {
    if(response.headersSent) {
        console.log(`headers sent for ${txnId} - most likely timed out`);
        txnMap.delete(txnId);
        return true;
    }

    return false;
}

const sendResponseBasedOnState = (state, txnId, response, txnMap) => {
    // When polling the state machine might still be running.
    if(state == 'RUNNING') {
        console.log('status is running - poll later');
        return;
    }

    if(state == 'SUCCEEDED') {
        console.log('response success');
        response.send(state);
    } else {
        console.log('response failure');
        response.status(400).send(state);
    }

    txnMap.delete(txnId);
}

const checkStateForTxn = async (txnId, txnMap, executionArn, resp) => {
    console.log(`checking state for execution ${executionArn}`);

    if(headersSentForTransaction(txnId, resp, txnMap)) {
        return;
    }

    try {
        let description = await stepFunctions.describeExecution({executionArn: executionArn}).promise();
        console.log(`call result: ${JSON.stringify(description)}`);
        let state = description['status'];
        sendResponseBasedOnState(state, txnId, resp, txnMap);
    } catch(err) {
        console.log(err.message);
    }

}

const doPollForResults = async () => {
    if(pollForResults == false) {
        return;
    }

    txnToResponseMap.forEach((txnTuple, txnId)=> {
        checkStateForTxn(txnId, txnToResponseMap, txnTuple['executionArn'], txnTuple['response']);
    });

    console.log('polling for results');
    setTimeout(doPollForResults, 5000);
}

const doPollTransitionResults = async() => {
    if(transitionTxnsMap.size == 0) {
        console.log('No transition results to process');
        return;
    }

    transitionTxnsMap.forEach((txnTuple, txnId)=> {
        console.log('poll transition event')
        checkStateForTxn(txnId, transitionTxnsMap, txnTuple['executionArn'], txnTuple['response']);
    });

    console.log('polling for transition results');
    setTimeout(doPollTransitionResults, 5000);
}


// Set up a timeout for this sample app - your timeout may be 
// different
app.use(timeout(20*1000));
app.use(haltOnTimeout);
app.use(bodyParser.json());

// Sample endpoint to initiate the step function process
// and the communication back of the response.
app.post('/p1', function (req, res) {
    invokeIt(req.body, res);
  });



function haltOnTimeout(req, res, next) {
    if (!req.timedout) next();
}

const handleStatusEvent = async (data) => {
    console.log(`handle stream data ${data}`);
    let parsedEvent = JSON.parse(data);
    let txnId = parsedEvent['txnId'];
    let tuple = txnToResponseMap.get(txnId);
    if(tuple == undefined) {
        console.log(`no tuple found for ${parsedEvent['txnId']}`);
        return;
    }

    let status = parsedEvent['status'];
    sendResponseBasedOnState(status, txnId, tuple['response'], txnToResponseMap);
}

//Note: this getRecords method DOES NOT handle stream resharding!
const getRecords = async (shardItor, limit) => {

    console.log(`get records for shardItor ${shardItor}`);
    const params = {
        ShardIterator: shardItor,
        Limit: limit
    };

    let data  = await kinesis.getRecords(params).promise();

    records = data['Records'];
    console.log(`${records.length} record(s)`);
    for(r of records) {
        handleStatusEvent(r['Data'].toString());
        //console.log(r['Data'].toString());
    }

    const nextItor = data['NextShardIterator'];

    //Do not call get records more than once a second - we'll be conservative
    //and go every 1.5 seconds
    setTimeout(() => {
        getRecords(nextItor, 5);
    }, 1500);
}

const getIterator = async (shard) => {
    //Here we use LATEST as the iterator type as we will only be consuming events
    //that are initiatd by this code.
    const params = {
        ShardId: shard['ShardId'],
        ShardIteratorType: 'LATEST', 
        StreamName: process.env.STREAM_NAME
    };

    let itor = await kinesis.getShardIterator(params).promise();
    getRecords(itor['ShardIterator'], 5);
}

const getShards = async () => {
    let data = await kinesis.describeStream({StreamName:process.env.STREAM_NAME}).promise();

    //TODO - just grabbing the shards returned by a single
   //call. A more robust app would look at the HasMoreShards flag and
    //keep calling describeStream until all the shards have been obtained.
    const shards = data['StreamDescription']['Shards'];
    return shards;

}

const startStreamReader = async () => {
    try {
        let shards = await getShards();
        for(shard of shards) {
            console.log(shard);
            getIterator(shard);
        }
    } catch(err) {
        console.log(err);
    }
}

const doInit = async () => {
    startStreamReader();
    let port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Example app listening on port ${port}`))
}

doInit();

