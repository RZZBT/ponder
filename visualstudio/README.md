# Ponder for Visual Studio

Visual Studio 2022 (17.10+) extension for C# and Visual Basic.

> Not compiled yet: the machine it was written on lacks the Visual Studio extension development workload.
> Expect small fixes on the first build.

## Build and run

1. Visual Studio Installer: add the **Visual Studio extension development** workload.
2. Open `Ponder.VisualStudio.csproj`, press <kbd>F5</kbd>. The build copies the engine from `../engine/dist`
   (it runs `npm run build` there if needed).
3. In the experimental instance, put the caret on a method and press <kbd>Alt</kbd>+<kbd>W</kbd>, or use
   **Open Ponder** in the editor context menu.

## How a call is matched

- Roslyn resolves the symbol at the caret; its documentation comment id is the symbol:
  `dotnet:M:MathUtils.Clamp(System.Int32,System.Int32,System.Int32)`. **Copy Ponder Symbol** copies it.
- Metadata references: `ponder.json` in the NuGet package folder (next to the `.nuspec`), or an embedded resource
  whose name ends in `ponder.json`. `library.name` must equal the package id when the `.nuspec` is found.
- Code in the solution: `ponder.json` next to the project file.
- The animation plays in a tool window (WebView2). The page validates the file with the engine before rendering.

## Shipping ponder.json in a NuGet package

```xml
<ItemGroup>
  <None Include="ponder.json" Pack="true" PackagePath="" />
</ItemGroup>
```
