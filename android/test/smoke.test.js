import { render } from '@testing-library/react-native'

jest.mock('react-native-bare-kit', () => {
  const fakeIPC = {
    on: jest.fn(),
    write: jest.fn()
  }

  class Worklet {
    constructor() {
      this.IPC = fakeIPC
    }

    start() {
      // no-op: the native worklet never actually boots under jest
    }
  }

  return { Worklet }
})

const Screen = require('../app/index').default

test('renders the echo screen without the native bare-kit module', async () => {
  const { toJSON } = await render(<Screen />)

  expect(toJSON()).not.toBeNull()
})
