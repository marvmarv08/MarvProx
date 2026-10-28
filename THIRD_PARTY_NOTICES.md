# Third-party notices

MarvProx's native component extends the MIT-licensed [GTProxy](https://github.com/ZTzTopia/GTProxy) source at commit `f51c5a3d66ed52af08e2dec8d0459876bc102e75`. The full upstream copyright and permission notice is preserved verbatim in [proxy/UPSTREAM_LICENSE.txt](proxy/UPSTREAM_LICENSE.txt).

The native preparation process also retrieves the exact submodules listed in `proxy/upstream.lock.json`: `cmake-conan`, `cpp-httplib`, and the upstream ENet dependency. Their original license files must remain with their respective checkouts and any distribution that includes their code. Conan dependencies retain their own licenses as well.

The repository contains MarvProx changes as patches and build helpers; it does not claim authorship of the upstream networking implementation or bundle the upstream checkout, dependencies, executables, or certificate material. This notice records third-party licensing and does not assign a new license to independently authored MarvProx files.
