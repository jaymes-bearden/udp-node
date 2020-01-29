'use strict';

const expect = require('chai').expect;
const UdpNode = require('../index');

const NO_OP = () => {
};

const $logger = {
  info: NO_OP,
  debug: NO_OP,
  error: NO_OP,
};

describe('udp-node', () => {
  let node;
  let otherNode;

  afterEach(() => {
    if (node) {
      node.close();
    }

    if (otherNode) {
      otherNode.close();
    }
  });

  it('should create a node', (done) => {
    node = new UdpNode($logger);
    node.set({name: 'test node'});
    expect(node).not.to.be.undefined;
    expect(typeof node.set).to.equal('function');
    expect(typeof node.ping).to.equal('function');
    expect(typeof node.broadcast).to.equal('function');
    expect(typeof node.onNode).to.equal('function');
    expect(typeof node.close).to.equal('function');
    expect(typeof node.on).to.equal('function');
    expect(typeof node.off).to.equal('function');

    node.close(done);
  });

  it('should provide chaining', (done) => {
    node = new UdpNode($logger);
    expect(node.set({name: 'test node, chaining'})).to.equal(node);
    expect(node.ping({address: '0.0.0.0'})).to.equal(node);
    expect(node.broadcast()).to.equal(node);
    expect(node.onNode()).to.equal(node);

    node.close(done);
  });

  it('should return the configuration on new instance', () => {
    node = new UdpNode($logger);

    expect(node.config()).to.have.keys('id');
  });

  it('should return the configuration on a configured instance', () => {
    node = new UdpNode($logger);
    node.set({name: 'test node'});

    expect(node.config()).to.have.keys('id', 'name', 'port', 'broadcastAddress');
  });

  it('should have an id', () => {
    node = new UdpNode($logger);
    expect(node.config().id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should broadcast', (done) => {
    node = new UdpNode($logger);
    node.set({
      name: 'node1',
      type: 'type1'
    });

    otherNode = new UdpNode($logger);
    otherNode
      .set({
        name: 'node2',
        type: 'type2',
        port: 3025
      })
      .broadcast({
        port: 3024
      })
      .onNode((message, rinfo) => {
        expect(message.address).not.to.be.undefined;
        expect(message.from).not.to.be.undefined;
        expect(message.port).to.equal(3025);
        expect(message.type).to.equal('pong');


        console.log(message.node);
        expect(message.node).to.eql({
          id: node.config().id,
          port: 3024,
          name: 'node1',
          broadcastAddress: '255.255.255.255'
        });


        node.close();
        otherNode.close();
        done();
      });
  });

  it('should broadcast with filter', (done) => {
    node = new UdpNode($logger);
    node.set({
      name: 'node1',
      type: 'type1'
    });

    otherNode = new UdpNode($logger);
    otherNode
      .set({
        name: 'node2',
        type: 'type2',
        port: 3025
      })
      .broadcast({
        filter: ['type1'],
        port: 3024
      })
      .onNode((message, rinfo) => {
        expect(message.address).not.to.be.undefined;
        expect(message.from).not.to.be.undefined;
        expect(message.port).to.equal(3025);
        expect(message.type).to.equal('pong');
        expect(message.node).to.eql({
          id: node.config().id,
          name: 'node1',
          port: 3024,
          broadcastAddress: '255.255.255.255'
        });
        node.close();
        otherNode.close();
        done();
      });
  });

  it('should ping', (done) => {
    node = new UdpNode($logger);
    node.set({
      name: 'node1',
      type: 'type1'
    });

    otherNode = new UdpNode($logger);
    otherNode
      .set({
        name: 'node2',
        type: 'type2',
        port: 3025
      })
      .broadcast({
        filter: ['type1'],
        port: 3024
      })
      .onNode((broadcastData, broadcastRinfo) => {
        // use address and port from remote node info to ping node
        otherNode
          .ping({
            address: broadcastRinfo.address,
            port: broadcastRinfo.port
          })
          .onNode((pingData, pingRinfo) => {
            expect(pingData).to.eql(broadcastData);
            node.close();
            otherNode.close();
            done();
          });
      });
  });

  it('should send custom messages', (done) => {
    node = new UdpNode($logger);
    node
      .set({
        name: 'node1',
        type: 'type1'
      })
      .on('hello', (message, rinfo) => {
        expect(message.text).to.equal('hey');
        node.close();
        otherNode.close();
        done();
      });

    otherNode = new UdpNode($logger);
    otherNode
      .set({
        name: 'node2',
        type: 'type2',
        port: 3025
      })
      .send({
        type: 'hello',
        port: 3024,
        text: 'hey'
      });
  });

  it('should turn off all custom message listeners', (done) => {
    node = new UdpNode($logger);
    node
      .set({
        name: 'node1',
        type: 'type1'
      });

    // add first callback
    node
      .on('hello', () => {
      });

    // add second callback, here we will test for both callback to be removed
    node
      .on('hello', () => {
        node.off('hello');
        expect(node.getEvents()['hello']).to.equal(undefined);

        node.close();
        otherNode.close();
        done();
      });

    otherNode = new UdpNode($logger);
    otherNode
      .set({
        name: 'node2',
        type: 'type2',
        port: 3025
      })
      .send({
        type: 'hello',
        port: 3024,
        text: 'hey'
      });
  });

  it('should turn off one custom message listener', (done) => {
    node = new UdpNode($logger);
    node
      .set({
        name: 'node1',
        type: 'type1'
      });

    const listnerId = node.on('hello', onHello);
    otherNode = new UdpNode($logger);
    otherNode
      .set({
        name: 'node2',
        type: 'type2',
        port: 3025
      })
      .send({
        type: 'hello',
        port: 3024,
        text: 'hey'
      });

    function onHello(message, rinfo) {
      node.off('hello', listnerId);
      expect(node.getEvents()['hello']).to.eql([]);

      node.close();
      otherNode.close();
      done();
    }
  });

  it('should throw an error when trying to ping without setup', () => {
    node = new UdpNode($logger);

    expect(() => {
      node.ping({address: '0.0.0.0'}, () => {
      });
    }).to.throw('Current node was not set up. Set it up using set({...}) before sending messages.');
  });

  it('should throw an error when trying to broadcast without setup', () => {
    node = new UdpNode($logger);

    expect(() => {
      node.broadcast();
    }).to.throw('Current node was not set up. Set it up using set({...}) before sending messages.');
  });

  it('should throw an error when trying to send custom message without setup', () => {
    node = new UdpNode($logger);

    expect(() => {
      node.send({});
    }).to.throw('Current node was not set up. Set it up using set({...}) before sending messages.');
  });

  it('should throw an error when trying to ping without address', () => {
    node = new UdpNode($logger).set({});

    expect(() => {
      node.ping({}, () => {
      });
    }).to.throw('Required params for ping method: address');
  });
});
