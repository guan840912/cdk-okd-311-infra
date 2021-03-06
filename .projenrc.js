const { AwsCdkTypeScriptApp } = require('projen');

const project = new AwsCdkTypeScriptApp({
  cdkVersion: '1.78.0',
  name: 'cdk-okd-311-infra',
  cdkDependencies: [
    '@aws-cdk/aws-ec2',
    '@aws-cdk/aws-route53',
    '@aws-cdk/aws-route53-targets',
  ],
  dependabot: false,
  defaultReleaseBranch: 'main',
});
const i = ['cdk.context.json', '.DS_Store'];
project.gitignore.exclude(...i);
project.synth();
