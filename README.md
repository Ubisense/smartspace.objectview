# ObjectView

This is the Ubisense ObjectView javascript client side library.

ObjectView allows client applications to access and subscribe to changes in the Ubisense SmartSpace® data model. ObjectView is based on [SignalR](https://github.com/SignalR/SignalR), and this library is a simple wrapper around the SignalR client to make it easy to subscribe to defined views.

Full documentation of ObjectView is currently maintained on [Ubisense Docs](https://docs.ubisense.com).

## Getting Started
Create an ObjectView instance, connect it, and then pass some ViewDef instances to the subscribe method.  The named views (ProductLocations,Products,Workspaces in the example below) are configured at the server side.  The targets will be updated as object properties change on the server side.  You can also set onChange and onEstablish of the ViewDef to get callbacks when data changes or the view is reconnected.

```
    ...
    this.objectView = new ObjectView()
      .onError(this.onerror.bind(this))
      .onConnected(this.onconnected.bind(this))
      .connect()
    objectView.subscribe(
      ObjectView.View(
        'ProductLocations',
        '04007zVJX_LAzXz9000kum0005S:ULocation::Cell',
      ).setTargetProperty(this, 'view'),
    )
    objectView.subscribe(
      ObjectView.View('Products')
        .setTargetProperty(this, 'products')
        .onEstablish((v) => {
          console.log('establish products', v)
        }),
    )
    this.objectView.subscribe(
      ObjectView.View('Workspaces').setTargetProperty(this, 'workspaces'),
    )
    ...
```

## Error Callback
From SmartSpace 3.9 and ObjectView v1.0.18, the error callback arguments have been updated.  The error callback is called with two arguments '(e, r)'.  The first is a string symbol indicating the error type, and the second is a variant argument with more information.  Here are the known error types:

| e           |	r       | Meaning |
| --------------| ----------- | ------------- |
| FailedToNegotiateWithServerError	| Error message, e.g. "Failed to complete negotiation with the server: Error: ..." | Connection could not be estabished, e.g. 401 or endpoint not found |
| ConnectionClosed |	Error message, e.g. "WebSocket closed with status code: 1006 (no reason given)" | Connection has been closed |
| UnknownView |	array of strings [ View ]  | Request to subscribe to a view which has not been defined in SmartSpace |
| Unauthorized	| array of strings [ User, View ] | Request to subscribe to a view for which the current user does not have an authorized role |

To get this full behaviour, the correct version of SmartSpace (3.9 or higher) must be installed on the server.  When connecting to an older version, ObjectView will still work, but the error callback will still receive HubException objects, with no way to distinguish between UnknownView and Unauthorized.  The compatibility matrix between old and new versions of the client and server is as follows:

| Server Version | Client Version | Behaviour |
| --- | --- | --- |
| <3.9 | <1.0.18 |HubExceptions for errors, passing exception text to error callback. |
| <3.9 | >=1.0.18 | HubExceptions for errors, and client behaves as old version did, passing exception text to error callback. |
| >=3.9 | <1.0.18 | Server behaves as old version, throwing HubExceptions for errors.  Client passes exception text to error callback. |
| >=3.9 | >=1.0.18 | Server returns errors as results field, which client passes on, with message and context, to the error callback. |
