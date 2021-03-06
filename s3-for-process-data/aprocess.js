const AWS = require('aws-sdk');
const S3 = new AWS.S3();
const stepFunctions = new AWS.StepFunctions();
const kinesis = new AWS.Kinesis();

class S3DataPreconditionError extends Error {
    constructor(...args) {
        super(...args)
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}


const readInputDataJSON = async (key, predicate) => {
    let params = {
        Bucket: process.env.BUCKET_NAME,
        Key: key
    };

    let s3response = await S3.getObject(params).promise();
    console.log(s3response);

    inputJSON = JSON.parse(s3response['Body'].toString());
    if(predicate(inputJSON)) {
        return inputJSON;
    }

    console.log(`consistency predicate failed`);
    
    throw new S3DataPreconditionError(`Unable to satisfy consistency predicate`);
}

const writeBodyObj = async(key, body) => {
    let putParams = {
        Body: JSON.stringify(body),
        Key: key,
        ServerSideEncryption: "AES256",
        Bucket: process.env.BUCKET_NAME
    };

    let s3response = await S3.putObject(putParams).promise();
    console.log(s3response);
    return s3response;
}

const doStep = async (outputKey, inputPredicate, result, event, context, callback) => {
    console.log(`doStep for ${outputKey}`);
    console.log(`event: ${JSON.stringify(event)})`);

    let key = event['processData'];
    console.log(`process data via key ${key}`);

    let processData = await readInputDataJSON(key, inputPredicate);
    console.log(`input: ${JSON.stringify(processData)}`);
    
    processData[outputKey] = result;
    await writeBodyObj(key, processData);

    //Make process data available to the next downstream process
    callback(null, event);
}

module.exports.stepA = async (event, context, callback) => {
    let key = event['processData'];

    //Write output to object
    let result = {
        status: 'ok',
        details: 'nothing to share',
        stepAOutput1: 'a1',
        stepAOutput2: false,
        stepAOutput3: 123
    };

    try {
        await doStep('step-a-output', stepAInputPredicate, result, event, context, callback);
    } catch(theError) {
        console.log(theError);
        await doNotification(event, 'FAILED');
        throw theError;
    }
}

module.exports.stepB = async (event, context, callback) => {
 
    
    //Write output to object
    let result = {
        property1: 'p1',
        property2: 'p2',
    };

    try {
        await doStep('step-b-output', stepBInputPredicate, result, event, context, callback);
    } catch(theError) {
        console.log(theError);
        await doNotification(event, 'FAILED');
        throw theError;
    }
}

module.exports.stepC = async (event, context, callback) => {
    console.log('step C invoked');
    let result = {
        cProperty: 'i like c'
    };

    try {
        await doStep('step-c-output',stepCInputPredicate, result, event, context, callback);
    } catch(theError) {
        console.log(theError);
        await doNotification(event, 'FAILED');
        throw theError;
    }
}

module.exports.stepD = async (event, context, callback) => {
    try {
        await doStep('step-d-output', stepDInputPredicate, {d: 'd output'}, event, context, callback);
    } catch(theError) {
        console.log(theError);
        await doNotification(event, 'FAILED');
        throw theError;
    }
}
module.exports.stepE = async (event, context, callback) => {
    try {
        await doStep('step-e-output',stepEInputPredicate, {e: 'e output'}, event, context, callback);
    } catch(theError) {
        console.log(theError);
        await doNotification(event, 'FAILED');
        throw theError;
    }
}

const kickOffDownstream = async (downstreamInput) => {
    console.log(`kickoffDownstream ${process.env.DOWNSTREAM_ARN}`);
    var params = {
        stateMachineArn: process.env.DOWNSTREAM_ARN,
        input: downstreamInput
    }

    let result = await stepFunctions.startExecution(params).promise();
    return result;
}

const doNotification = async (event,msg) => {
    let key = event['processData'];
    let eventData = {
        txnId: key,
        status: msg
    };

    let params = {
        Data: JSON.stringify(eventData),
        PartitionKey: key,
        StreamName: process.env.STATUS_STREAM_NAME
    }
    
    let streamResult = await kinesis.putRecord(params).promise();
    console.log(streamResult);
}

module.exports.stepF = async (event, context, callback) => {
    console.log(`event: ${JSON.stringify(event)})`);

    let key = event['processData'];
    console.log(`process data via key ${key}`);

    try {
        let processData = await readInputDataJSON(key, stepFInputPredicate);
        console.log(`processData: ${JSON.stringify(processData)}`);

        let result = await kickOffDownstream(JSON.stringify(event));
        console.log(result);
        processData['step-f-output'] = {
            downstreamExecutionArn: result['executionArn']
        }
        await writeBodyObj(key, processData);

        await doNotification(event, 'SUCCEEDED');

        callback(null, event);
    } catch(theError) {
        console.log(theError);
        await doNotification(event, 'FAILED');
        throw theError;
    }
}

const stepAInputPredicate = (o) => {
    return true;
}

const stepBInputPredicate = (o) => {
    return o.hasOwnProperty('step-a-output');
}

const stepCInputPredicate = (o) => {
    return o.hasOwnProperty('step-b-output');
}

const stepDInputPredicate = (o) => {
    return o.hasOwnProperty('step-c-output');
}

const stepEInputPredicate = (o) => {
    return o.hasOwnProperty('step-d-output');
}

const stepFInputPredicate = (o) => {
    return o.hasOwnProperty('step-e-output');
}



