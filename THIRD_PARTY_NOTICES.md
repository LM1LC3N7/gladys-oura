# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the projects below, distributed under
the MIT License, whose notices are reproduced in full as that license asks.

## oura-ring

<https://github.com/hedgertronic/oura-ring>, a Python client for the Oura API
v2 (PyPI package `oura-ring`). MIT License (`LICENSE` of the repository,
version 1.0.1, commit `691dc2e`, read on 2026-10-21).

Ported in `src/constants.js` and `src/oauth.js`: the authorization address and
its parameters, the documented token endpoint, the form of the code exchange
and of the renewal (client id and secret in the body), the scopes and the
renewal tokens that serve once.

```
MIT License

Copyright (c) 2022 Josh Hejka

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Oura-Home-Assistant-Integration

<https://github.com/louispires/Oura-Home-Assistant-Integration>, the Oura
integration for Home Assistant. MIT License (`LICENSE` of the repository,
commit `a3943180`, read on 2026-10-21).

Ported in `src/constants.js`, `src/api.js` and `src/model.js`: the API base,
the collections and their date or time parameters, the paging by
`next_token`, the live token endpoint (`moi.ouraring.com`, the default), the choice of
the records (latest daily record, completed main sleep, latest heart rate
sample) and the fields read from each.

```
MIT License

Copyright (c) 2025 louispires

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
