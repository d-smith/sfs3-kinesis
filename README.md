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