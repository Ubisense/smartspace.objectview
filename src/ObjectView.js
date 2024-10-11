/**
 * @preserve
 * The copyright in this software is being made available under the 2-clauses
 * BSD License, included below. This software may be subject to other third
 * party and contributor rights, including patent rights, and no such rights
 * are granted under this license.
 *
 * Copyright (c) 2024, Ubisense Limited
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

import { HubConnectionState, HubConnectionBuilder } from '@microsoft/signalr';
import { IdCreator } from './IdCreator.js';
import packageInfo from '../package.json';

const fallbackCell = '000004000000000000000000000:ULocation::Cell';

class ViewDef {
  _view = undefined;
  _cell = undefined;
  _target = undefined;
  _prop = undefined;
  _establish_cb = undefined;
  _change_cb = undefined;
  _sequence = undefined;
  _field_map = undefined;
  _owner = undefined;

  constructor(view, cell) {
    this._view = view;
    this._cell = this._normalizeCell(cell);
  }

  setCell(cell) {
    this._cell = this._normalizeCell(cell);
    return this;
  }

  setFallbackCell() {
    this._cell = fallbackCell;
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

  _normalizeCell(cell) {
    if (!cell) return cell;
    let l = cell.toLowerCase();
    if (l == 'fallback') return fallbackCell;
    else if (l == 'site') return 'site';
    return cell;
  }

  _changeCommands(id, new_values, old_values) {
    // If there are no old_values then this is just a set command
    if (old_values === undefined) {
      return this._setCommands(id, new_values);
    }

    var result = {
      commands: [],
      commit: () => {
        return this._owner.commitChanges(result.commands);
      },
    };

    // Find the commands used to set the state in 'new_values'
    // and 'old_values', which will be 'news' and 'olds'
    // respectively.
    var news = this._setCommands(id, new_values).commands;
    var olds = this._setCommands(id, old_values).commands;

    // Only change properties that are actually mentioned in
    // 'new_values' by filtering out properties from 'olds'
    // if they do not correspond to a field in 'new_values'
    // (deletions will count as [] or null)
    var property_modes = {};
    for (const [name, accessor] of Object.entries(this._field_map)) {
      var field = new_values[name];
      if (field === undefined) continue;
      property_modes[accessor[0]] = 1;
    }
    function relevant(command) {
      return !(property_modes[command.property] === undefined);
    }
    olds = olds.filter(relevant);

    // Sort the commands and then perform a merge/difference iteration
    function compare_arrays(lhs, rhs) {
      for (var i = 0; i < lhs.length; ++i) {
        if (lhs[i] < rhs[i]) return -1;
        if (lhs[i] > rhs[i]) return +1;
      }
      return 0;
    }
    function compare_commands(lhs, rhs, value) {
      if (lhs.property < rhs.property) return -1;
      if (lhs.property > rhs.property) return +1;
      var args = compare_arrays(lhs.args, rhs.args);
      if (args != 0) return args;
      if (!value) return 0;
      if (lhs.value < rhs.value) return -1;
      if (lhs.value > rhs.value) return +1;
      return 0;
    }
    function row_compare(lhs, rhs) {
      return compare_commands(lhs, rhs, true);
    }
    function key_compare(lhs, rhs) {
      return compare_commands(lhs, rhs, false);
    }
    function key_lt(lhs_it, lhs, rhs_it, rhs) {
      if (lhs_it >= lhs.length) return false;
      if (rhs_it >= rhs.length) return true;
      if (key_compare(lhs[lhs_it], rhs[rhs_it]) < 0) return true;
      return false;
    }
    function key_eq(lhs_it, lhs, rhs_it, rhs) {
      if (lhs_it >= lhs.length) return false;
      if (rhs_it >= rhs.length) return false;
      if (key_compare(lhs[lhs_it], rhs[rhs_it]) == 0) return true;
      return false;
    }
    news.sort(row_compare);
    olds.sort(row_compare);
    var new_it = 0;
    var old_it = 0;
    while (old_it < olds.length || new_it < news.length) {
      // Command key is present in 'new' but not in 'old', so
      // just use it
      while (key_lt(new_it, news, old_it, olds)) {
        result.commands.push(news[new_it]);
        ++new_it;
      }
      // Command key is present in 'old' but not in 'new' so
      // generate a command to negate it
      while (key_lt(old_it, olds, new_it, news)) {
        var command = olds[old_it];
        command.value = null;
        result.commands.push(command);
        ++old_it;
      }
      // Both old and new set this key, so use the command in 'old'
      if (key_eq(new_it, news, old_it, olds)) {
        if (olds[old_it].value != news[new_it].value) {
          result.commands.push(news[new_it]);
        }
        ++old_it;
        ++new_it;
      }
    }
    return result;
  }

  _setCommands(id, object_values) {
    if (this._field_map === undefined) {
      throw "attempt to create commands for a non-updateable view";
    }
    var result = {
      commands: [],
      commit: () => {
        return this._owner.commitChanges(result.commands);
      }
    };
    for (const [name, accessor] of Object.entries(this._field_map)) {
      var field = object_values[name];
      if (field === undefined) continue;
      var values;
      if (Array.isArray(field)) values = field;
      else values = [field];
      for (const value of values) {
        var command = {
          property: accessor[0],
          args: [],
        };
        for (var i = 1; i < accessor.length; ++i) {
          var udm_value;
          switch (accessor[i][0]) {
            case 1: // Implicit instance of true
              udm_value = true;
              break;
            case 2: // Instance of the key
              udm_value = id;
              break;
            case 3: // Instance of the value as a scalar
              udm_value = value;
              break;
            case 4: // Instance of a scalar field of the value as an object
              udm_value = value[accessor[i][1]];
              break;
            case 0:
            default:
              console.error(`illegal field map code ${accessor[i][0]}`);
              throw "illegal field map code " + accessor[i][0];
          }
          if (i < accessor.length - 1) {
            command.args.push(udm_value);
          } else {
            command.value = udm_value;
          }
        }
        result.commands.push(command);
      }
    }
    return result;
  }

  _copyFields(object_values) {
    if (this._field_map === undefined) {
      throw "attempt to copy fields of a non-updateable view";
    }
    var result = {};
    // If a value has fields then copy each field, 
    // otherwise just copy the entire scalar value
    var copy_value = (source, fields) => {
      if (fields.length == 0)
        return source;
      var result = {};
      for (var i = 0; i < fields.length; ++i) {
        result[fields[i]] = source[fields[i]];
      }
      return result;
    }
    // For each field mentioned in the field map,
    for (const [field_name, accessor] of Object.entries(this._field_map)) {
      var source = object_values[field_name];
      // If this field name is missing in the source data then ignore it
      if (source === undefined) continue;
      // If the field has subfields then get their names
      var subfield_names = [];
      for (var i = 1; i < accessor.length; ++i) {
        if (accessor[i][0] == 4) {
          subfield_names.push(accessor[i][1]);
        }
      }
      // If the field is an array then copy make a copy of it 
      if (Array.isArray(source)) {
        result[field_name] = [];
        for (let i = 0; i < source.length; ++i) {
          result[field_name].push(copy_value(source[i], subfield_names));
        }
      } else {
        result[field_name] = copy_value(source, subfield_names);
      }
    }
    return result;
  }

  _applyDump(errorCallback, res) {
    if (res.result.message != "OK")
    {
      // Error has occurred.
      errorCallback(res.result.message, res.result.context);
      return;
    }

    if (res.contents) {
      const dump = JSON.parse(res.contents);
      this._sequence = dump.seq;
      delete dump.seq;
      if (this._target) {
        if (this._prop) {
          // We do it this way so reactive systems such as Vue will pick up the new key and add reactivity.
          this._target[this._prop] = Object.assign(
            {},
            this._target[this._prop],
            dump
          );
          this._attachViewDef(this._target[this._prop]);
        } else {
          this._cloneInto(this._target, dump);
        }
      }
    } else {
      // Sequence will be picked up from first change.
      this._sequence = undefined;
    }

    if (res.changes) this._applyChanges(JSON.parse(res.changes));

    if (this._establish_cb) this._establish_cb(res);
  }

  _cloneInto(target, dump) {
    // Make the properties of target match dump.
    let ds = [];
    for (const key of Object.keys(target)) {
      if (!Object.prototype.hasOwnProperty.call(dump, key)) ds.push(key);
    }
    for (const [key, value] of Object.entries(dump)) {
      target[key] = value;
    }
    for (const key of ds) {
      delete target[key];
    }
    this._attachViewDef(target);
  }

  _attachViewDef(target) {
    // Make a reference back to the view definition to support the
    // ObjectView.set and ObjectView.change functions.  
    // Make it not enumerable, so it isn't returned when iterating through the object keys.      
    Object.defineProperty(target, "_view_def", { enumerable: false, writable: true });
    target._view_def = () => {
      return this;
    };
  }

  _applyChanges(m) {
    if (Array.isArray(m)) {
      m.forEach(this._applyChanges.bind(this));
      return;
    }

    if (m.type == "est") {
      // This is an establish. Parent will have scheduled a dump.
      return;
    }

    const seq = m["seq"];
    if (seq == undefined) return;

    if (!this._target && this._sequence == undefined) {
      // Initialize the sequence number if we are not maintaining a target view, and we haven't already.
      this._sequence = m.seq;
    } else {
      // Check for skipped sequence number.
      if (m.seq != this._sequence + 1) {
        throw { error: "Sequence Error " + m.view + " " + m.seq + " current " + this._sequence };
      }

      this._sequence = m.seq;
    }

    if (m.batch) {
      m.batch.forEach(this._applyChange.bind(this));
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

      if (v.type == "ins" || v.type == "upd") {
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
            if (v.type == "ins") {
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
            // This may not be necessary with Vue3 ref that have deep reactivity.
            let toAdd = {};
            toAdd[v._id] = doc;
            this._target[this._prop] = Object.assign({}, view, toAdd);
            // Re-attach view def to the copied view.
            this._attachViewDef(this._target[this._prop]);
          } else {
            view[v._id] = doc;
          }
        }
      } else if (v.type == "del") {
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


/**
 * The ObjectView api for connecting to views defined in SmartSpace.
 * @export
 * @class ObjectView
 */
export default class ObjectView {
  #errorCallback = undefined;

  _connected_cb = undefined;

  _connection = undefined;

  _views = {};

  _rebinds = {};

  static View(view, cell) {
    return new ViewDef(view, cell);
  }

  static update(view_target, id, values) {
    return view_target._view_def()._changeCommands(id, values, view_target[id]);
  }

  static copy(view_target, id) {
    return view_target._view_def()._copyFields(view_target[id]);
  }


  /**
   * Creates an instance of ObjectView.
   * @param {boolean|string} anonOrAddress Boolean true means allow anonymous accces, false means require authentication.
   * Otherwise you can pass a string to attempt to connect to a different hub.
   * @param {object} Pass SignalR HttpConnectionOptions https://learn.microsoft.com/en-us/javascript/api/@microsoft/signalr/ihttpconnectionoptions
   * @memberof ObjectView
   */
  constructor(anonOrAddress, connectionOptions = {}) {

    let hub;
    if (typeof anonOrAddress == "boolean") {
      hub = anonOrAddress ? '/SmartSpace/ObjectViewAnon' : '/SmartSpace/ObjectView';
    }
    else {
      if (anonOrAddress) hub = anonOrAddress;
      else hub = '/SmartSpace/ObjectView';
    }

    this._connection = new HubConnectionBuilder()
      .withUrl(hub, connectionOptions)
      .build();

    // Create a function that the hub can call to send change messages.
    this._connection.on("viewEvent", this.#viewEvent.bind(this));

    this._connection.onclose((err) => {
      this.#reconnectError("ConnectionClosed", err.message);
    });
  }

  connect() {
    if (this._connection.state === HubConnectionState.Connected) {
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
    this._connected_cb = cb;
    return this;
  }

  subscribe(def) {
    var k = this.#getKey(def._view, def._cell);
    this._views[k] = def;
    if (this._connection.state === HubConnectionState.Connected) {
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

  static #creator = new IdCreator();

  /**
   * Create a new unique object instance of the given type.
   * @param {string} type The raw type name in SmartSpace, e.g. "UserDataModel::[Custom]Product"
   * @memberof ObjectView
   * @returns {string} the unique object id
   */
  static createObject(type) {
    return ObjectView.#creator.generate() + ":" + type;
  }

  // Async method to commit a set of changes, represented as
  // [{property:<UDM property name>, args:[arg0,..]}, value:arg]
  async commitChanges(params) {
    if (params.length == 0) {
      return false;
    }
    params = JSON.stringify(params);
    var response = await this._connection.invoke(
      "Execute",
      "Commit_Changes",
      params
    );
    var result = JSON.parse(response);
    if (!(result["error"] === undefined))
      throw result;
    return result;
  }

  // Async method to get cells covering a given region.
  async getCells(params) {
    if (!(params instanceof String)) {
      params = JSON.stringify(params);
    }
    var res = await this._connection.invoke("Execute", "Get_Cells", params);
    return JSON.parse(res);
  }

  // Async method to query a given object value from a view without caching or receiving updates.
  // Params should be { view: 'view', cell: 'cell', _id: 'key' }
  async getValue(params) {
    if (!(params instanceof String)) {
      params = JSON.stringify(params);
    }
    var res = await this._connection.invoke("Execute", "Get_Value", params);
    return JSON.parse(res);
  }

  async getFieldMap(params) {
    var res = await this._connection.invoke("Execute", "Get_Mapping", params);
    return JSON.parse(res);
  }

  getVersion() {
    return packageInfo.version;
  }

  // Leave the field map of a view definition either set to the field map
  // retrieved from the server, or set to null (if the view is not an
  // updateable view)
  #ensureFieldMap = function (view) {
    view._field_map = undefined;
    view._owner = this;
    this.getFieldMap(view._view)
      .then((res) => (view._field_map = res["field_map"]));
  };

  #viewEvent = function (view, message) {
    try {
      const m = JSON.parse(message);
      this.#applyChanges(m);
    } catch (err) {
      this.#reconnectError(err);
    }
  };

  // Called when connection is made or on establish.
  #registerAll = async function () {
    if (this._connected_cb) this._connected_cb();

    // Get the site cell on first connection.
    await this.#getSiteCell();

    // Register each view.
    for (var v in this._views) {
      this.#registerView(this._views[v]);
    }
  };

  #registerView = function (def) {
    const params = { Version: 1, View: def._view };
    if (def._cell) params.Cell = def._cell;
    if (!def._target) params.WithoutDump = true;

    // Skip regsiter view if already in progress.
    if (def._registerInProgress) return;
    def._registerInProgress = true;

    var regError = this.#registerError.bind(this);
    this._connection
      .invoke("RegisterView", params)
      .then(def._applyDump.bind(def, regError))
      .catch(regError)
      .finally(() => def._registerInProgress = false);
   
    this.#ensureFieldMap(def);
  };

  #deregisterView = function (def) {
    const params = { View: def._view };
    if (def._cell) params.Cell = def._cell;

    this._connection.invoke("DeregisterView", params);
  };

  #registerError = function (error, reason) {
    if (this.#errorCallback) {
      var { e, r } = this.#decodeError(error, reason);
      this.#errorCallback(e, r);
    }
  };

  #reconnectError = function (error, reason) {
    if (this.#errorCallback) {
      var { e, r } = this.#decodeError(error, reason);
      this.#errorCallback(e, r);
    }
    this.#backoffConnect();
  };

  #backoffConnect = function () {
    // Backoff a random time and reconnect.
    var r = Math.floor(Math.random() * 1000) + 500;
    setTimeout(this.connect.bind(this), r);
  };

  #doRebinds = function () {
    for (const [name, seq] of Object.entries(this._rebinds)) {
      let def = this._views[name];

      if (def) {
        if (def._sequence != seq) {
          // Schedule a reconnect.
          this.#registerView(def);
        }
      }
    }
    this._rebinds = {};
  };

  #rebind = function (m) {
    let v = m.view;
    if (v) {
      // Request a rebind of this view only.
      let c = m.cell;
      let k = this.#getKey(v, c);

      // We delay rebinding to avoid multiple requests for high update rate views.
      this._rebinds[k] = m.seq;

      var r = Math.floor(Math.random() * 1000) + 500;
      setTimeout(this.#doRebinds.bind(this), r);
    }
    else {
      this._rebinds = {};
      this.#backoffConnect();
    }
  };

  #applyChanges = function (m) {
    if (m.type == "est") {
      this.#rebind(m);
      return;
    }

    if (Array.isArray(m)) {
      m.forEach(this.#applyChanges.bind(this));
      return;
    }

    var v = m.view;
    var c = m.cell;

    var k = this.#getKey(v, c);
    var def = this._views[k];
    if (!def) {
      // Try the empty cell.
      k = this.#getKey(v);
      def = this._views[k];
    }
    if (!def) {
      return;
    }

    try {
      def._applyChanges(m);
    } catch (e) {
      this.#rebind(m);
    }
  };

  #getKey = function (view, cell) {
    if (cell == this._siteCell) cell = "";
    if (cell == "site") cell = "";
    return (view ?? "") + ":" + (cell ?? "");
  };

  #getSiteCell = async function () {
    const large = 1e16;
    let cells = await this.getCells({ type: 'Polygon', coordinates: [[[-large, -large], [large, -large], [large, large], [-large, large]]] });
    for (var f of cells.features) {
      let p = f.properties;
      if (p && p.level == 3) {
        this._siteCell = p.id;
      }
    }
  };

  #decodeError = function (error, reason) {
    var e, r;
    if (error instanceof Error) {
      if (error.errorType) {
        e = error.errorType;
        r = error.message;
      } else {
        e = error;
        r = reason;
      }
    }
    else {
      e = error.message ?? error;
      r = error.reason ?? reason;
    }
    return { e, r };
  };
}


