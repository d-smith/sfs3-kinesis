#! /bin/bash
STAGE=""
REGION=""

POSITIONAL=()
while [[ $# -gt 0 ]]
do
key="$1"

case $key in
    -s|--stage)
    STAGE="$2"
    shift # past argument
    shift # past value
    ;;
    -r|--region)
    REGION="$2"
    shift # past argument
    shift # past value
    ;;
    *)    # unknown option
    POSITIONAL+=("$1") # save it in an array for later
    shift # past argument
    ;;
esac
done

echo "Stage is " $STAGE
echo "Region is " $REGION
mkdir -p package
sls package -s $STAGE -r $REGION -p package
cd package
cp ../serverless.yml .
cp ../package.json .
cp ../../deploy/deployspec.yml .
zip s3processdata-app.zip *
aws s3 cp s3processdata-app.zip s3://$DEPLOY_BUCKET
