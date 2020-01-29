'use strict';

const dgram = require('dgram');
const uuid = require('uuid/v4');

const DEFAULTS = {
  PORT: 3024,
  BROADCAST_ADDRESS: '255.255.255.255',
  NO_OP: () => {
  },
};

class UdpNode {
  constructor(logger) {
    this.events = {};
    this.config = {
      id: uuid(),
    };

    this.logger = logger;
    this.onNodeCallback = DEFAULTS.NO_OP;

    this.client = dgram.createSocket('udp4');
    this.isClosed = false;
  }

  /**
   * Set configuration and start listening for UDP messages
   */
  set(config) {
    this.logger.debug('-- Setting configuration:', config);

    this.config.id = config.id || this.config.id;
    this.config.port = config.port || DEFAULTS.PORT;
    this.config.broadcastAddress = config.broadcastAddress || DEFAULTS.BROADCAST_ADDRESS;
    this.config.name = config.name || null;

    this.client.on('listening', () => {
      const address = this.client.address();
      this.logger.debug(`[ ${this.toSimpleName()} ]--> listening on ${address.address}:${address.port}`);
      this.client.setBroadcast(true);
    });

    this.client.on('message', (message, rinfo) => {
      try {
        message = JSON.parse(message.toString());

        // There are three basic types of messages:
        // - ping: sent to specific node
        // - pong: sent to specific node answering a ping or broadcast, giving node's identity
        // - broadcast: sent to all nodes, asking for their identity; allows filtering.
        // So, if we receive a ping or broadcast we need to send a pong with our identity.
        // If we receive a pong we need to check if we're interested in that node's
        // identity and if so we fire the onNode event.
        if (message.type === 'ping') return this.onPing(message, rinfo);
        if (message.type === 'pong') return this.onPong(message, rinfo);
        if (message.type === 'broadcast') return this.onBroadcast(message, rinfo);

        // custom events
        if (this.isCustomEvent(message.type)) return this.onCustomEvent(message.type, message, rinfo);
      } catch (ex) {
        this.logger.error(`[ ${this.toSimpleName()} ]--> could not parse client message`, ex);
      }

      // invalid event
      this.logger.debug(`[ ${this.toSimpleName()} ]--> got INVALID message:`, JSON.stringify(message));
    });

    this.client.bind(this.config.port);

    // allow chaining
    return this;
  }

  wasSetup() {
    return (Object.keys(this.config).length > 1);
  }

  isCustomEvent(type) {
    return (type in this.events);
  }

  /**
   * Fires all listeners for passed custom event.
   *
   * @param  {string} type
   * @param  {object} message
   * @param  {object} rinfo
   */
  onCustomEvent(type, message, rinfo) {
    this.logger.debug(`[ ${this.toSimpleName()} ]--> got ${type}:`, JSON.stringify(message));

    this.events[type].map((callback) => {
      if (typeof callback === 'function') callback(message, rinfo);
    });
  }

  /**
   * Sends a broadcast message to the network.
   * Used to find nodes of the specified types or all nodes if filter
   * is not specified.
   * Nodes automatically respond to broadcast messages with a pong.
   *
   * @param {object:} params {filter, port, address, data}
   * @return {object} pointer to this instance, allows chaining
   */
  broadcast(params) {
    if (!this.wasSetup()) throw new Error('Current node was not set up. Set it up using set({...}) before sending messages.');

    let filter, port, address, data;
    if (params) {
      filter = params.filter;
      port = params.port;
      address = params.address;
      data = params.data;
    }
    this.logger.debug(`[ ${this.toSimpleName()} ]--> looking for nodes:`, filter || 'ALL');

    const message = {
      type: 'broadcast',
      node: this.config,
      filter: filter,
      data: data,
      port: port || this.config.port || DEFAULTS.PORT,
      address: address || this.config.broadcastAddress
    };

    this.send(message);

    // allow chaining
    return this;
  }

  /**
   * Sends a ping message to the specified address on the specified port
   * with the specified data.
   * Nodes automatically respond to ping messages with a pong.
   *
   * @param {object} {address, port, data}
   * @return {object} pointer to this instance, allows chaining
   */
  ping({address, port, data = null}) {
    if (!this.wasSetup()) throw new Error('Current node was not set up. Set it up using set({...}) before sending messages.');
    if (!address) throw new Error('Required params for ping method: address');
    port = port || DEFAULTS.PORT;

    this.logger.debug(`[ ${this.toSimpleName()} ]--> sending PING to ${address}:${port}`);

    const message = {
      type: 'ping',
      node: this.config,
      data: data,
      port: port,
      address: address
    };

    this.send(message);

    // allow chaining
    return this;
  }

  /**
   * Answer remote nodeping message with a nodepong.
   * Send current node's identity to remote peer.
   * Should not be used directly.
   *
   * @param {object} message
   * @param {object} rinfo
   */
  pong(message, rinfo) {
    const pongMessage = {
      type: 'pong',
      port: rinfo.port,
      address: rinfo.address,
      node: this.config
    };

    this.send(pongMessage);
  }

  /**
   * Send passed message.
   *
   * @param  {object} message
   * @param  {Function} [callback]
   * @return {object} pointer to this instance, allows chaining
   */
  send(message, callback) {
    // handle errors
    if (!this.wasSetup()) throw new Error('Current node was not set up. Set it up using set({...}) before sending messages.');
    if (!message.type) throw new Error('Missing property "message.type" when calling send(message, callback).');

    // add sender identity
    message.from = this.config.id;

    // defaults
    message.port = message.port || DEFAULTS.PORT;
    message.address = message.address || DEFAULTS.BROADCAST_ADDRESS;

    const messageString = JSON.stringify(message);
    this.client.send(messageString, 0, messageString.length, message.port, message.address, (err) => {
      this.logger.debug(`[ ${this.toSimpleName()} ]--> ${message.type} SENT`);
      if (typeof callback === 'function') callback(err);
    });

    // allow chaining
    return this;
  }

  /**
   * Returns true if received message was sent by a node that passes current filter.
   * If filter is not set ALL nodes are of interest.
   * Automatically filters own messages.
   * A node being of interest means we will respond to the received message.
   *
   * @param  {object} message
   * @return {Boolean}
   */
  isNodeOfInterest(message) {
    // ignore our own messages
    if (message.from === this.config.id) return false;

    // not filtering nodes, interested in all of them
    if (!message.filter || !message.filter.length) return true;

    // if current node doesn't have type consider it of interest
    if (this.config.type === undefined) return true;

    // we have a node filter
    // is a node of interest?
    return (message.filter.indexOf(this.config.type) !== -1);
  }

  /**
   * Called each time a new node is found.
   *
   * @param  {Function} callback
   * @returns {object} this
   */
  onNode(callback) {
    this.onNodeCallback = callback;

    // allow chaining
    return this;
  }

  /**
   * Called each time a ping message is recived.
   * Sends a pong in response.
   *
   * @param  {object} message
   * @param  {object} rinfo
   */
  onPing(message, rinfo) {
    // ignore nodes we're not interest into
    if (!this.isNodeOfInterest(message)) return;

    this.logger.debug(`[ ${this.toSimpleName()} ]--> got PING:`, JSON.stringify(message));
    this.onNodeCallback(message, rinfo);
    this.pong(message, rinfo);
  }

  /**
   * Called each time a broadcast message is recived.
   * Sends a pong in response.
   *
   * @param  {object} message
   * @param  {object} rinfo
   */
  onBroadcast(message, rinfo) {
    // ignore nodes we're not interest into
    if (!this.isNodeOfInterest(message)) return;

    this.logger.debug(`[ ${this.toSimpleName()} ]--> got BROADCAST:`, JSON.stringify(message));
    this.onNodeCallback(message, rinfo);
    this.pong(message, rinfo);
  }

  /**
   * Called each time a pong message is recived.
   * Fires the onNode callback if set.
   * This is what happens after a ping or broadcast messages are recived.
   *
   * @param  {object} message
   * @param  {object} rinfo
   */
  onPong(message, rinfo) {
    this.logger.debug(`[ ${this.toSimpleName()} ]--> got PONG:`, JSON.stringify(message));
    this.onNodeCallback(message, rinfo);
  }

  /**
   * Adds a custom event listener.
   * The passed callback will be called every time a message with a type
   * that matches it is received.
   *
   * @param  {string} type
   * @param  {Function} callback
   * @returns {object} this
   */
  on(type, callback) {
    // validate params
    if (!type) throw new Error('Missing param "type" when calling on(type, callback).');
    if (!callback) throw new Error('Missing param "callback" when calling on(type, callback).');
    if (typeof callback !== 'function') throw new Error('Invalid param "callback" when calling on(type, callback). Must be a function.');

    if (!this.events[type]) this.events[type] = [];
    this.events[type].push(callback);
    return this;
  }

  /**
   * If index is passed removes the matching listener for passed message type.
   * If index is not provided removes ALL listeners for this type.
   *
   * @param  {string} type
   * @param  {int} index
   */
  off(type, index) {
    // validate params
    if (!type) throw new Error('Missing param "type" when calling off(type, index).');

    // completely turn off this event
    if (index === undefined) {
      delete this.events[type];
      return;
    }

    // turn off only specified listener
    this.events[type].splice(index, 1);
  }

  /**
   * Closes current UDP connection.
   *
   * @param  {Function} [callback]
   */
  close(callback) {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    this.logger.debug(`[ ${this.toSimpleName()} ]--> CLOSE`);
    this.client.close(callback);
  }

  toSimpleName() {
    return `${this.config.name}${this.config.type ? ` (${this.config.type})` : ''}`;
  }
}

// Shield UdpNode behind a facade.
// This hides methods and properties that should not be public.
module.exports = function UdpNodeFacade(logger) {
  const node = new UdpNode(logger);

  this.set = (config) => {
    node.set(config);
    return this;
  };

  this.config = () => {
    return {...node.config};
  };

  this.broadcast = (params) => {
    node.broadcast(params);
    return this;
  };

  this.ping = (params) => {
    node.ping(params);
    return this;
  };

  this.send = (message, callback) => {
    node.send(message, callback);
    return this;
  };

  this.onNode = (callback) => {
    node.onNode(callback);
    return this;
  };

  this.on = (type, callback) => {
    return node.on(type, callback);
  };

  this.off = (type, index) => {
    node.off(type, index);
  };

  this.close = (callback) => {
    node.close(callback);
  };

  this.getEvents = () => {
    return node.events;
  };
};
