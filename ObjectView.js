'use strict';

/* 
 * The copyright in this software is being made available under the 2-clauses 
 * BSD License, included below. This software may be subject to other third 
 * party and contributor rights, including patent rights, and no such rights
 * are granted under this license.
 *
 * Copyright (c) 2022, Ubisense Limited
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS `AS IS'
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/*  This library is maintained on github, so look there for more recent versions. */

const signalR = require('@microsoft/signalr');

class ViewDef {

    _view = undefined;
    _cell = undefined;
    _target = undefined;
    _prop = undefined;
    _establish_cb = undefined;
    _change_cb = undefined;
    _sequence = undefined;

    constructor(view, cell) {
        this._view = view;
        this._cell = cell;
    }

    setCell(cell) {
        this._cell = cell;
        return this;
    }

    setTargetObject(target) {
        this._target = target;
        this._prop = undefined;
        return this;
    }

    setTargetProperty(target, prop) {
        this._target = target;
        this._prop = prop;
        return this;
    }

    onEstablish(cb) {
        this._establish_cb = cb;
        return this;
    }

    onChange(cb) {
        this._change_cb = cb;
        return this;
    }

    _applyDump(res) {
        if (res.contents) {
            const dump = JSON.parse(res.contents);
            this._sequence = dump.seq;
            delete dump.seq;

            if (this._target) {
                if (this._prop) {
                    // We do it this way so reactive systems such as Vue will pick up the new key and add reactivity.
                    this._target[this._prop] = Object.assign({}, this._target[this._prop], dump);
                } else {
                    this._target = dump;
                }
            }
        } else {
            // Sequence will be picked up from first change.
            this._sequence = undefined;
        }

        if (res.changes) this._applyChanges(JSON.parse(res.changes))

        if (this._establish_cb) this._establish_cb(res);
    }

    _applyChanges(m) {

        if (Array.isArray(m)) {
            m.forEach(this._applyChanges.bind(this))
            return
        }

        if (m.type == 'est') {
            // This is an establish. Parent will have scheduled a dump.
            return;
        }

        const seq = m["seq"];
        if (seq == undefined) return;

        if ((!this._target) && (this._sequence == undefined)) {
            // Initialize the sequence number if we are not maintaining a target view, and we haven't already.
            this._sequence = m.seq;
        } else {
            // Check for skipped sequence number.
            if (m.seq != this._sequence + 1) {
                throw { error: 'Sequence Error' };
            }

            this._sequence = m.seq;
        }

        if (m.batch) {
            m.batch.forEach(this._applyChange.bind(this))
        } else {
            this._applyChange(m);
        }
    }

    _applyChange(v) {
        if (!v._id) return;

        // If a target is set, update the cached view.
        if (this._target) {

            const view = this._prop ? this._target[this._prop] : this._target;
            let doc = view[v._id];

            if (v.type == 'ins' || v.type == 'upd') {

                if (doc) {
                    // This copy is done so reactive systems pick up the change.
                    let copy = Object.assign({}, doc);

                    if (v.idx == undefined) {
                        // Not an array-valued property.
                        copy[v.prop] = v.val;
                    } else {
                        // An array valued property.
                        // If no current value, create a new empty array.
                        if (!copy[v.prop]) copy[v.prop] = [];
                        // Splice or set value at index.
                        if (v.type == 'ins') {
                            copy[v.prop].splice(v.idx, 0, v.val);
                        } else {
                            copy[v.prop][v.idx] = v.val;
                        }
                    }

                    // Assign back for reactive systems.
                    view[v._id] = copy;
                } else {
                    // The key has no current document in the view, so create one.
                    doc = {};
                    if (v.idx == undefined) {
                        doc[v.prop] = v.val;
                    } else {
                        doc[v.prop] = [v.val];
                    }

                    // Add to the view.
                    if (this._prop) {
                        // We do it this way so reactive systems such as Vue will pick up the new key and add reactivity.
                        let toAdd = {};
                        toAdd[v._id] = doc;
                        this._target[this._prop] = Object.assign({}, view, toAdd);
                    } else {
                        view[v._id] = doc;
                    }
                }

            } else if (v.type == 'del') {

                if (doc) {
                    if (v.idx == undefined) {
                        // Not an array-valued property.
                        doc[v.prop] = undefined;
                        delete doc[v.prop];
                    } else {
                        // For an array, splice to delete the index.
                        doc[v.prop].splice(v.idx, 1);
                        // Remove an empty array.
                        if (doc[v.prop].length == 0) {
                            doc[v.prop] = undefined;
                            delete doc[v.prop];
                        }
                    }

                    // Remove an empty object document.
                    if (Object.keys(doc).length === 0) {
                        view[v._id] = undefined;
                        delete view[v._id];
                    }
                }

            }
        }

        // If a callback is set, call it.
        if (this._change_cb) this._change_cb(v);
    }
}

const ObjectView = class ObjectView {

    #errorCallback = undefined;

    #connectedCallback = undefined;

    _connection = undefined;

    _views = {};

    _reconnecting = undefined;

    static View(view, cell) {
        return new ViewDef(view, cell);
    }

    // Constructor tags the view name, an optional cell, and optional target object to populate with the view documents.
    constructor(useAnon) {

        let hub = useAnon ? '/SmartSpace/ObjectViewAnon' : '/SmartSpace/ObjectView';
        console.log(hub);
        this._connection = new signalR.HubConnectionBuilder()
            .withUrl(hub)
            .build();

        // Create a function that the hub can call to send change messages.
        this._connection.on('viewEvent', this.#viewEvent.bind(this));

        this._connection.onclose((err) => {
            this.#reconnectError("Connection Closed", err);
        });
    }

    connect() {
        this._reconnecting = false;

        if (this._connection.state === signalR.HubConnectionState.Connected) {
            this.#registerAll();
            return;
        }

        this._connection
            .start()
            .then(this.#registerAll.bind(this))
            .catch(this.#reconnectError.bind(this));

        return this;
    }

    onError(cb) {
        this.#errorCallback = cb;
        return this;
    }

    onConnected(cb) {
        this.#connectedCallback = cb;
        return this;
    }

    subscribe(def) {
        var k = this.#getKey(def._view, def._cell);
        this._views[k] = def;
        if (this._connection.state === signalR.HubConnectionState.Connected) {
            this.#registerView(def);
        }
    }

    unsubscribe(def) {
        var k = this.#getKey(def);
        try {
            this.#deregisterView(def);
        } finally {
            delete this._views[k];
        }
    }

    // Async method to get cells covering a given region.
    async getCells(params) {
        if (!(params instanceof String)) {
            params = JSON.stringify(params);
        }
        var res = await this._connection.invoke('Execute', 'Get_Cells', params);
        return JSON.parse(res);
    }

    // Async method to query a given object value from a view without caching or receiving updates.
    // Params should be { view: 'view', cell: 'cell', _id: 'key' }
    async getValue(params) {
        if (!(params instanceof String)) {
            params = JSON.stringify(params);
        }
        var res = await this._connection.invoke('Execute', 'Get_Value', params);
        return JSON.parse(res);
    }

    #viewEvent = function (view, message) {
        try {
            const m = JSON.parse(message)
            this.#applyChanges(m)
        } catch (err) {
            this.#reconnectError(err);
        }
    }

    // Called when connection is made or on establish.
    #registerAll = function () {
        if (this.#connectedCallback) this.#connectedCallback();

        // Register each view.
        for (var v in this._views) {
            this.#registerView(this._views[v]);
        }
    }

    #registerView = function (def) {
        const params = { View: def._view };
        if (def._cell) params.Cell = def._cell;
        if (!def._target) params.WithoutDump = true;

        this._connection
            .invoke('RegisterView', params)
            .then(def._applyDump.bind(def))
            .catch(this.#registerError.bind(this));
    }

    #deregisterView = function (def) {
        const params = { View: def._view };
        if (def._cell) params.Cell = def._cell;

        this._connection
            .invoke('DeregisterView', params);
    }

    #registerError = function (error, reason) {
        var e = error.message ?? error;
        if (this.#errorCallback) {
            var r = error.reason ?? reason;
            this.#errorCallback(e, r);
        }
    }

    #reconnectError = function (error, reason) {
        var e = error.message ?? error;
        if (this.#errorCallback) {
            var r = error.reason ?? reason;
            this.#errorCallback(e, r);
        }
        this.#backoffConnect();
    }

    #backoffConnect = function () {
        // Backoff a random time and reconnect.
        if (this._reconnecting) return;

        this._reconnecting = true;
        var r = Math.floor(Math.random() * 1000) + 500;
        setTimeout(this.connect.bind(this), r);
    }

    #applyChanges = function (m) {

        if (m.type == 'est') {
            // This is an establish.  Schedule a reconnect.
            this.#backoffConnect();
            return;
        }

        if (Array.isArray(m)) {
            m.forEach(this.#applyChanges.bind(this))
            return
        }

        var v = m.view;
        var c = m.cell;

        var k = this.#getKey(v, c);
        var def = this._views[k];
        if (!def) return;

        def._applyChanges(m);
    }

    #getKey = function (view, cell) {
        return (view ?? "") + ":" + (cell ?? "");
    }

};

export { ObjectView };
