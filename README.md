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