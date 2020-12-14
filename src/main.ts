import * as ec2 from '@aws-cdk/aws-ec2';
import * as r53 from '@aws-cdk/aws-route53';
import { App, Construct, Stack, StackProps, Duration, CfnResource, CfnOutput } from '@aws-cdk/core';

export class MyStack extends Stack {
  readonly privateR53: r53.IHostedZone;
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
    const okdVpc = new ec2.Vpc(this, 'okdVpc', {
      maxAzs: 2,
      natGateways: 0,
      cidr: '10.168.0.0/16',
      subnetConfiguration: [{
        cidrMask: 24,
        name: 'public',
        subnetType: ec2.SubnetType.PUBLIC,
      }],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    this.privateR53 = new r53.PrivateHostedZone(this, 'privateDNS', {
      vpc: okdVpc,
      zoneName: 'okdcluster.com',
    });

    const okdBastion = new ec2.BastionHostLinux(this, 'okdBastion', {
      instanceName: 'okdBastion',
      vpc: okdVpc,
      instanceType: new ec2.InstanceType('t3.micro'),
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
    } );
    okdBastion.instance.addUserData('');
    const userData = ec2.UserData.forLinux();
    userData.addCommands(`
    yum update -y
    yum install centos-release-openshift-origin311 -y 
    yum install wget git net-tools bind-utils iptables-services bridge-utils bash-completion kexec-tools sos psacct bash-completion.noarch bash-completion-extras.noarch python-passlib unzip tree docker  -y
    yum install NetworkManager -y
    systemctl start NetworkManager && systemctl enable NetworkManager
    `);

    const ClusterSG = new ec2.SecurityGroup(this, 'ClusterSG', {
      securityGroupName: 'OKD-CDK-ClusterSG',
      vpc: okdVpc,
    });
    const MasterSG = new ec2.SecurityGroup(this, 'MasterSG', {
      securityGroupName: 'OKD-CDK-MasterSG-Pub',
      vpc: okdVpc,
    });
    const InfraSG = new ec2.SecurityGroup(this, 'InfraSG', {
      securityGroupName: 'OKD-CDK-InfraSG-Pub',
      vpc: okdVpc,
    });
    this.addinsIngress([MasterSG, ClusterSG, InfraSG], '10.0.0.0/16');
    InfraSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    InfraSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    MasterSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8443));

    const masterNode = this.createInstance('OKD-CDK-Master', okdVpc, userData, MasterSG);
    const infraNode = this.createInstance('OKD-CDK-Infra', okdVpc, userData, InfraSG);
    const ap1Node = this.createInstance('OKD-CDK-Ap1', okdVpc, userData, ClusterSG);
    const ap2Node = this.createInstance('OKD-CDK-Ap2', okdVpc, userData, ClusterSG);
    const ap3Node = this.createInstance('OKD-CDK-Ap3', okdVpc, userData, ClusterSG);
    this.registerPrivateDns('master', masterNode.instancePrivateIp);
    this.registerPrivateDns('infra', infraNode.instancePrivateIp);
    this.registerPrivateDns('ap1', ap1Node.instancePrivateIp);
    this.registerPrivateDns('ap2', ap2Node.instancePrivateIp);
    this.registerPrivateDns('ap3', ap3Node.instancePrivateIp);
    const masterEip = new ec2.CfnEIP(this, 'masterEip', {
      tags: [{
        key: 'Name',
        value: 'masterEip',
      }],
    });
    const infraEip = new ec2.CfnEIP(this, 'infraEip', {
      tags: [{
        key: 'Name',
        value: 'infraEip',
      }],
    });
    const masterEipAssociation = new ec2.CfnEIPAssociation(this, 'masterEipAssociation', {
      instanceId: masterNode.instanceId,
      allocationId: masterEip.attrAllocationId,
    });
    const infraEipAssociation = new ec2.CfnEIPAssociation(this, 'infraEipAssociation', {
      instanceId: infraNode.instanceId,
      allocationId: infraEip.attrAllocationId,
    });
    masterEipAssociation.addDependsOn(masterNode.node.defaultChild as CfnResource);
    infraEipAssociation.addDependsOn(infraNode.node.defaultChild as CfnResource);
    new CfnOutput(this, 'ssmSample', {
      value: `aws ssm start-session --target ${okdBastion.instanceId}`,
    });
  }
  private addinsIngress(sgs: ec2.SecurityGroup[], ipRange: string) {
    sgs.forEach(sg => {
      sg.addIngressRule(ec2.Peer.ipv4(ipRange), ec2.Port.allTraffic());
    });
    return ;
  }

  private registerPrivateDns(recordName: string, target: string) {
    return new r53.RecordSet(this, recordName, {
      recordType: r53.RecordType.A,
      recordName: recordName,
      zone: this.privateR53,
      target: r53.RecordTarget.fromIpAddresses(target),
      ttl: Duration.minutes(1),
    });
  }

  private createInstance(name: string, vpc: ec2.IVpc, userData: ec2.UserData, ClusterSG: ec2.SecurityGroup):ec2.Instance {
    return new ec2.Instance(this, name, {
      instanceType: new ec2.InstanceType('r5.large'),
      vpc: vpc,
      machineImage: ec2.MachineImage.lookup({
        filters: {
          ['product-code']: ['aw0evgkw8e5c1q413zgy5pjce'],
        },
        name: '*CentOS*',
        owners: ['aws-marketplace'],
      }),
      securityGroup: ClusterSG,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      blockDevices: [{
        deviceName: '/dev/sda1',
        volume: ec2.BlockDeviceVolume.ebs(120),
      }],
      userData,
      keyName: 'replace-your-key-pair-name',
      instanceName: name,
    });
  }
}

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new MyStack(app, 'okd-cluster', { env: devEnv });

app.synth();