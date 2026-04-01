// test-ink.tsx
import { useState, useEffect } from "react";
import { render, Box, Text, useStdout } from "ink";
import { jsx, jsxs } from "react/jsx-runtime";
var App = () => {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns, rows: stdout.rows });
  useEffect(() => {
    const onResize = () => setSize({ columns: stdout.columns, rows: stdout.rows });
    stdout.on("resize", onResize);
    return () => stdout.off("resize", onResize);
  }, [stdout]);
  return /* @__PURE__ */ jsx(Box, { width: size.columns, height: size.rows, borderStyle: "round", children: /* @__PURE__ */ jsxs(Text, { children: [
    "Width: ",
    size.columns,
    ", Height: ",
    size.rows
  ] }) });
};
render(/* @__PURE__ */ jsx(App, {}));
