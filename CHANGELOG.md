# Changelog

## 1.0.0 (2026-09-17)


### Features

* add standalone distribution build ([06b8aee](https://github.com/console-craft/work-craft/commit/06b8aee638749ee6a6d5ccac524ea61e924c6150))
* **cli:** add local work craft commands ([01f193f](https://github.com/console-craft/work-craft/commit/01f193f650050cc0c93f7117daf05fe7260c6749))
* implement first vertical slice ([5edbc0e](https://github.com/console-craft/work-craft/commit/5edbc0e24c619ad630e81db8a1bc55fe5391126d))
* **server:** add durable work model ([2d312ba](https://github.com/console-craft/work-craft/commit/2d312ba0f522fdd16b65b65e747e546700dd91a4))
* **server:** add organizational commands ([3f5d0f8](https://github.com/console-craft/work-craft/commit/3f5d0f8ee5ae9c9c67405126d8cf09fcd01ac0ac))
* **server:** add terminal surfaces and splits ([70aa6f6](https://github.com/console-craft/work-craft/commit/70aa6f677feeb3c2d0226856f793b850bbd1b5b7))
* **server:** expose local command api ([c45cee6](https://github.com/console-craft/work-craft/commit/c45cee6ea453f2cb2c092df7dda8fecfd3f87a11))
* **server:** manage local daemon lifecycle ([e5d0a26](https://github.com/console-craft/work-craft/commit/e5d0a26dd5706b3cefe6a329e8f44d126adf683c))
* **server:** own shell pty runtimes ([e446cfe](https://github.com/console-craft/work-craft/commit/e446cfe8c21851074f3b8b494f1118c114291704))
* **server:** persist bounded terminal history ([6e7f3ce](https://github.com/console-craft/work-craft/commit/6e7f3ce6db15bb20ad8f12a776cbe3b2b7bd4b09))
* **server:** restore shells after restart ([4c36efe](https://github.com/console-craft/work-craft/commit/4c36efe9c6ff81b757de6bb25aed0cf701caad37))
* **tui:** add work navigator ([c14a7a3](https://github.com/console-craft/work-craft/commit/c14a7a342de95dec1cdb9f38ff13fec46d8d5c14))
* **tui:** render persistent terminal surfaces ([7a780c3](https://github.com/console-craft/work-craft/commit/7a780c308f8d512baf86f08ead777cbfa55a4c00))


### Bug Fixes

* address first slice review findings ([ac2afa1](https://github.com/console-craft/work-craft/commit/ac2afa1ba98d34de4e46088244577ec415ebfe09))
* **cli:** bound cleanup observers ([03e532e](https://github.com/console-craft/work-craft/commit/03e532eac96406e7cb61f9c450e02cd6d5e0975d))
* **cli:** harden output and test cleanup ([3444fd1](https://github.com/console-craft/work-craft/commit/3444fd1f5285b52a6f056c4a06878ec2c19ce857))
* **cli:** preserve failed cleanup state ([c038e40](https://github.com/console-craft/work-craft/commit/c038e405c66f243055d18e02f81e23f2e3f9556b))
* **server:** drain PTY output before cleanup ([88f63a5](https://github.com/console-craft/work-craft/commit/88f63a55b6e83d4f1f3acb824b6e92a8a99083bf))
* **server:** harden cold recovery lifecycle ([f0e762c](https://github.com/console-craft/work-craft/commit/f0e762cba5dc3975bc00c9143c9ed395c2ca08cc))
* **server:** harden daemon correctness ([a36e9f5](https://github.com/console-craft/work-craft/commit/a36e9f5ecbabbd7dfce1bb879591cb7c64d90010))
* **server:** harden daemon lifecycle ([9d7af9b](https://github.com/console-craft/work-craft/commit/9d7af9beb132b33eff819073c3178ec1c1f01b91))
* **server:** inherit split pane restore policy ([a31b410](https://github.com/console-craft/work-craft/commit/a31b410b650636b421db57a96c10d5c6668a383f))
* **server:** preserve empty shell arguments ([bc970ba](https://github.com/console-craft/work-craft/commit/bc970ba57ea6ae9fad9d21fa0ebbcff9f77607f4))
* **server:** preserve history and snapshot ordering ([d3dd9fc](https://github.com/console-craft/work-craft/commit/d3dd9fc8f08ed46e5fbf1576696c92fb651002ba))
* **server:** prevent lock identity ABA ([71aa89b](https://github.com/console-craft/work-craft/commit/71aa89bca8f7f14f39669fb83defedb572d21603))
* **server:** serialize takeover and shutdown ([436c5de](https://github.com/console-craft/work-craft/commit/436c5de03b73d2dd925c755930e44d21469065b4))
* **server:** serialize takeover claim election ([7ecd455](https://github.com/console-craft/work-craft/commit/7ecd455ac650b2c8b749d3263c38d4b2c391ce77))
* **server:** stop listener when chmod fails ([c9e9133](https://github.com/console-craft/work-craft/commit/c9e9133cbf016142563a601b410bf06f0c2d5810))
* **server:** use unique takeover claims ([a4862a4](https://github.com/console-craft/work-craft/commit/a4862a446494ea1ce884c18ec15e319520b4b23f))
* **tui:** preserve terminal streams ([dbdfc37](https://github.com/console-craft/work-craft/commit/dbdfc3794bcb140f6d2b6428db8ff8fabdae4ab6))
* **tui:** reconcile terminal surface state ([88e1ce5](https://github.com/console-craft/work-craft/commit/88e1ce5fa4aaf100e97d0bf2d66333c2e9b706a4))
* **tui:** recover failed snapshot refresh ([9dbcf74](https://github.com/console-craft/work-craft/commit/9dbcf7411db1d362143aa84ef2b1d3d3f4587f0b))
