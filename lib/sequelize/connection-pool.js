var ConnectionPool = module.exports = function (config, maxPoolSize) {
    this.config = config
    this.maxPoolSize = maxPoolSize || 1;

    this.activeConnections = 0;
    this.connectionPool = [];
    this.waitingQueue = [];
};


/**
 * Internal helper that takes a connection and a callback, prepares the
 * connection for use again and sends it to the callback.
 * @param connection
 * @param callback
 * @returns
 */
ConnectionPool.prototype.sendConnection = function (connection, callback) {
    var self = this;

    // Remove any listeners the user may have added
    connection.removeAllListeners('error');

    // If the user doesn't catch errors, catch them , close the client and
    // remove it from the pool.
    connection.on('error', function (err) {
        self.activeConnections -= 1;
        connection.end();
    });

    return callback(null, connection);
};


/**
 * Acquire a connection from the connection pool. The connection is returned
 * to the callback when a connection is ready. If no connections are available,
 * the callback is placed on a queue and is sent a connection when the next
 * connection is released.
 *
 * @param callback
 * @returns
 */
ConnectionPool.prototype.acquire = function (callback) {
    var self = this;

    if (this.connectionPool.length) {
        // There's already a connection free, acquire it and return it.
        return this.sendConnection(this.connectionPool.pop(), callback);
    }
    else if (this.activeConnections <= this.maxPoolSize) {
        this.activeConnections += 1;

        // Create a new connection if there are less than maxPoolSize already.
        var connection = require('mysql').createClient({
            user: this.config.username,
            password: this.config.password,
            host: this.config.host,
            port: this.config.port,
            database: this.config.database
        });
        return self.sendConnection(connection, callback);
    }
    else {
        // Add this request to the waiting list. Will be given a connection
        // when one is returned to the pool.
        return this.waitingQueue.push(callback);
    }
};


/**
 * Releases a connection to be used again by another query. Must be called to
 * avoid starving other consumers.
 *
 * @param connection
 * @returns
 */
ConnectionPool.prototype.release = function (connection) {
    var self = this;

    if (this.waitingQueue.length) {
        // If there's already a client waiting on the connection, bypass the
        // free pool and send it along. Add the callback to the event loop to
        // avoid causing any delay to the client releasing a connection.
        var waiter = this.waitingQueue.shift();
        process.nextTick(function () {
            return self.sendConnection(connection, waiter);
        });
    }
    else {
        // Released connections go back on the free pool.
        this.connectionPool.push(connection);
    }
};
